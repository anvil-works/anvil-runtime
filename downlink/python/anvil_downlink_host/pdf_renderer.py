import json
from pathlib import Path

from anvil_downlink_host import send_with_header as send_to_server
import anvil_downlink_host
from random import SystemRandom
import subprocess
import pychrome
import base64
import sys
import threading
import time
from select import select
import os.path
import shutil
from pprint import pprint
from numbers import Number
from tempfile import NamedTemporaryFile, TemporaryDirectory
import random
import string

if sys.version_info < (3,0,0):
    import urllib
    _urlencode = lambda s: urllib.quote(s,safe='')
else:
    import urllib.parse
    _urlencode = lambda s: urllib.parse.quote(s,safe='')

DISABLE_SANDBOX = os.environ.get("DISABLE_SANDBOX", False)
DISABLE_DEV_SHM = os.environ.get("DISABLE_DEV_SHM", False)
DISABLE_CERTIFICATE_CHECK = os.environ.get("DISABLE_CERTIFICATE_CHECK", False)
CUSTOM_CERTIFICATE_PATH = os.environ.get("CUSTOM_CERTIFICATE_PATH")

if os.getuid() == 0:
    CHROME_SUDO_PREFIX = ["sudo", "-u", "nobody"]
else:
    CHROME_SUDO_PREFIX = []


def init():
    if CUSTOM_CERTIFICATE_PATH:
        Path("/tmp/.pki/nssdb").mkdir(parents=True, exist_ok=True)
        subprocess.run(["certutil", "-d", "sql:/tmp/.pki/nssdb", "-N", "--empty-password"])

        for cert_file in Path(CUSTOM_CERTIFICATE_PATH).glob("*.crt"):
            cmd = ["certutil", "-d", "sql:/tmp/.pki/nssdb", "-A", "-t", "P,,", "-n", str(cert_file), "-i", str(cert_file)]
            print("Running " + " ".join(cmd))
            subprocess.run(cmd)


# Sandboxing args for PS2PDF
def run_ps2pdf(quality, infile, outfile):
    with TemporaryDirectory() as tmpdir:
        if os.getuid() != 0 or DISABLE_SANDBOX:
            args = ["/usr/bin/ps2pdf", f"-dPDFSETTINGS=/{quality}", infile, outfile]
        else:
            os.mkdir(tmpdir+"/tmp")
            print("ls "+tmpdir)
            os.system("ls "+tmpdir)
            os.chmod(infile, 0o644)
            os.chmod(outfile, 0o666)
            os.chmod(tmpdir, 0o755)
            args = ["minijail0",
                    ## Errors on stdout, please (defaults to syslog)
                    "--logging=stderr",
                    ## Uncomment to catch minijail error logs that don't go to stderr despite the
                    ## previous line (grr).
                    ## NB if you do this in prod, you'll need to volume in /dev/log or minijail will
                    ## bail out
                    #"-b", "/dev/log",
                    # Run as 'nobody'
                    "-u", "nobody",
                    # Disable SysV shared-mem/IPC
                    "-l",
                    # Isolate from other processes
                    "-p",
                    # No hostname changes
                    "--uts",
                    # Freeze cgroups settings
                    "-N",
                    # Pivot-root to our temporary directory
                    "-P", tmpdir,
                    # Add a /tmp filesystem
                    "-t",
                    # Mount in system files ps2pdf needs
                    "-b", "/usr", "-b", "/bin", "-b", "/lib", "-b", "/lib64", "-b", "/etc", "-b", "/dev/urandom",
                    # Only permit a few system calls
                    "-S", anvil_downlink_host.__path__[0]+"/ps2pdf-seccomp.policy",
                    # Mount in the files (only the output is writable)
                    "-b", infile+",/input.pdf",
                    "-b", outfile+",/output.pdf,1",
                    # Now the actual invocation
                    "/usr/bin/ps2pdf",
                    f"-dPDFSETTINGS=/{quality}",
                    "/input.pdf",
                    "/output.pdf"
                    ]
        print(" ".join(args))
        return subprocess.run(args, capture_output=True)



# A generator that reads lines from a BufferedReader until the timeout expires. We can't use readline because that can block forever.
def non_blocking_readlines(f, timeout):
    start_time = time.time()
    byte_buffer = b""
    while time.time() < start_time + timeout:
        (readable,_,_) = select([f], [], [], 0.1)
        if f in readable:
            byte_buffer += f.read1(1024)
            lines = byte_buffer.split(b'\n')
            byte_buffer = lines[-1]
            for line in lines[:-1]:
                yield line.decode("utf-8")


# Returns True if we should wait for this network request to complete before printing.
def is_interesting_network_request(request):
    # This might be useful at some point, if we want to be cleverer about which requests to wait for
    # pprint({request['request']['url']: (request['initiator']['type'],request['initiator'].get('stack', None)))
    return True


# Yes, Chrome uses inches. Anvil uses sensible units.
CM_TO_INCH = 1/2.54


class Browser:
    def __init__(self, msg):
        try:
            self.id = msg['id']
            self.print_url = msg['args'][0]
            self.print_options = msg['args'][1]
            self.load_timeout = msg['args'][2] if len(msg['args']) > 2 else 30
            self.filename = self.print_options.pop('filename', 'print.pdf')
            self.quality = self.print_options.pop('quality', "default")
            if self.quality not in ["original", "screen", "printer", "prepress", "default"]:
                raise Exception(f"Invalid PDF quality '{self.quality}' - must be one of ['original', 'screen', 'printer', 'prepress', 'default']")
        except Exception as e:
            print(f"Invalid request to printing service: {e}")
            self.send_error(e)
        else:
            # TODO: We may want to kill the entire Python process if the timeouts in run_browser aren't enough to guarantee this thread ends.
            threading.Thread(target=self.run_browser).start()

    def run_browser(self):
        port = SystemRandom().randint(10000, 20000)
        print(f"Booting browser on port {port}...")
        # Chrome starts lots of processes. Use os.setsid to start all of them in a new process group, so we can kill them all later.
        tmp_dir = "".join(random.choices(string.ascii_uppercase + string.digits, k=10))
        os.mkdir(f"/tmp/{tmp_dir}")

        if CUSTOM_CERTIFICATE_PATH:
            shutil.copytree("/tmp/.pki", f"/tmp/{tmp_dir}/.pki")

        if CHROME_SUDO_PREFIX:
            subprocess.run(["chown", "-R", "nobody", f"/tmp/{tmp_dir}"])

        cmd = " ".join([
            f"HOME=/tmp/{tmp_dir}",
            "google-chrome",
             "--headless",
             "--disable-gpu",
             f"--remote-debugging-port={port}",
             ("--disable-dev-shm-usage" if DISABLE_DEV_SHM else ""),
             ("--no-sandbox" if DISABLE_SANDBOX else ""),
             ("--ignore-certificate-errors" if DISABLE_CERTIFICATE_CHECK else ""),
        ])
        print(cmd)
        with subprocess.Popen(CHROME_SUDO_PREFIX + ["bash", "-c", cmd], stderr=subprocess.PIPE, stdout=subprocess.PIPE, preexec_fn=os.setsid) as process:
            try:
                # Wait for Chrome to boot, and devtools to initialise. Only wait ten seconds, otherwise fail.
                for line in non_blocking_readlines(process.stderr, 10):
                    print(f"Chrome: {line}")
                    if line.startswith("DevTools listening"):
                        break
                else:
                    raise Exception("Could not initialise printing service within allowed time.")

                print("Connecting to Chrome...")
                browser = pychrome.Browser(f"http://127.0.0.1:{port}")
                print("Setting up tab...")
                tab = browser.new_tab()
                tab.start()
                tab.Network.enable()
                #tab.Network.clearBrowserCache()
                tab.Runtime.enable()

                ready_to_print = False
                print_error = None

                def handle_console_output(args, **kwargs):
                    nonlocal ready_to_print, print_error
                    print(f"Console: {args}")
                    if args and args[0].get('value', None) == "READY_TO_PRINT": # This string is console.log'd in runner.js.
                        ready_to_print = True
                    elif args and args[0].get('value', None) == "PRINT_ERROR":
                        print_error = args[1].get('value')


                outstanding_network_requests = {}
                def network_request_sent(requestId, **request):
                    if is_interesting_network_request(request):
                        outstanding_network_requests[requestId] = request

                def network_request_failed(requestId, errorText, **kwargs):
                    print(errorText, outstanding_network_requests[requestId]['request']['url'])
                    outstanding_network_requests.pop(requestId,None)

                def network_request_finished(requestId, **kwargs):
                    outstanding_network_requests.pop(requestId, None)

                def network_request_cached(requestId, **kwargs):
                    outstanding_network_requests.pop(requestId, None)


                tab.set_listener("Runtime.consoleAPICalled", handle_console_output)
                tab.set_listener("Network.requestWillBeSent", network_request_sent)
                tab.set_listener("Network.loadingFailed", network_request_failed)
                tab.set_listener("Network.loadingFinished", network_request_finished)
                tab.set_listener("Network.requestServedFromCache", network_request_cached) # Not sure if loadingFinished also fires in this case. Do this just to be safe.

                print(f"Navigating to {self.print_url}")
                tab.Page.navigate(url=self.print_url)

                print("Waiting for components to load...")
                loading_start = time.time()
                while time.time() < loading_start + self.load_timeout: # Give things 30 seconds to load.
                    time.sleep(0.01)
                    if ready_to_print and len(outstanding_network_requests) == 0:
                        break
                    if print_error:
                        print(f"It's all gone to pot: {print_error}")
                        self.send_exception(json.loads(print_error))
                        return
                else:
                    if not ready_to_print:
                        raise Exception("Components did not load within allowed time.")
                    else:
                        print("Outstanding network requests:")
                        pprint(outstanding_network_requests)
                        raise Exception("Network requests did not complete within allowed time.")


                time.sleep(0.5) # Give another half-second after everything seems ready, just to make sure rendering is done.

                print("Printing...")
                pdfdata = tab.Page.printToPDF(displayHeaderFooter=False, printBackground=True, **self.get_pdf_options())
                print("Encoding...")
                pdfbytes = base64.b64decode(pdfdata['data'])
                print(f"Generated PDF of {len(pdfbytes)} bytes")

                browser.close_tab(tab)

                if self.quality != "original":
                    print("Compressing PDF...")                

                    # http://web.mit.edu/ghostscript/www/Ps2pdf.htm
                    
                    # This would be the simple way to do it, but ps2pdf is really slow via stdin/stdout...
                    # ps2pdf = subprocess.run(["ps2pdf", f"-dPDFSETTINGS=/{self.quality}", "-"], input=pdfbytes, capture_output=True)
                    # pdfbytes = ps2pdf.stdout

                    # ... So we use temporary files. Sigh.
                    try:
                        with NamedTemporaryFile(delete=False) as src:
                            src_name = src.name
                            src.write(pdfbytes)
                            src.close()

                            with NamedTemporaryFile(delete=False) as dest:
                                dest_name = dest.name
                                dest.close()

                                ps2pdf = run_ps2pdf(self.quality, src_name, dest_name)

                                if os.path.getsize(dest_name) < len(pdfbytes):
                                    with open(dest_name, "rb") as new_pdf:
                                        pdfbytes = new_pdf.read()

                                    print(f"Compressed PDF to {len(pdfbytes)} bytes")
                                else:
                                    print("No gain from compression")
                    finally:
                        try:
                            os.unlink(src_name)
                            os.unlink(dest_name)
                        except:
                            pass
                    # </silly temp file thing>

                    if ps2pdf.stderr or ps2pdf.returncode != 0:
                        raise Exception(f"Error running ps2pdf: {ps2pdf.stderr.decode('utf-8')}")



                print("Responding...")
                self.send_response(pdfbytes)
                print("PDF returned.")
            except Exception as e:
                import traceback
                traceback.print_exc()
                print(f"It's all gone to pot: {e}")
                self.send_error(e)
            finally:
                for line in non_blocking_readlines(process.stderr, 2):
                    print(f"Chrome: {line}")

                # Don't just kill the subprocess, also terminate all the processes it created.
                os.killpg(os.getpgid(process.pid), 15)
                print("******* Chrome terminated *******")
                cpid = -1
                n_terminated = 0
                while cpid != 0:
                    cpid, _, _ = os.wait4(-1, os.WNOHANG)
                    if cpid != 0:
                        n_terminated += 1
                print(f"{n_terminated} children reaped")
                shutil.rmtree(f"/tmp/{tmp_dir}", ignore_errors=True)

    def get_pdf_options(self):
        # Whitelist these options carefully; they're going into the management end of Chrome
        options = {}
        for k,v in self.print_options.items():
            if k == "landscape":
                options["landscape"] = bool(v)
            elif k == "scale":
                options["scale"] = float(v)
            elif k == "margins":
                if isinstance(v, Number):
                    v = {"top": v, "bottom": v, "left": v, "right": v}

                for side in ["top", "bottom", "left", "right"]:
                    if side in v:
                        options[f"margin{side.capitalize()}"] = float(v[side]) * CM_TO_INCH
            elif k == "page_size":
                if type(v) is str:
                    size = {'A0': (84.1, 118.9),
                            'A1': (59.4, 84.1),
                            'A2': (42.0, 59.4),
                            'A3': (29.7, 42.0),
                            'A4': (21.0, 29.7),
                            'A5': (14.8, 21.0),
                            'A6': (10.5, 14.8),
                            'A7': (7.4, 10.5),
                            'A8': (5.2, 7.4),
                            'A9': (3.7, 5.2),
                            'A10': (2.6, 3.7),
                            'LETTER': (21.6, 27.9)}
                    if v.upper() in size:
                        v = size[v.upper()]
                    else:
                        raise ValueError(f"Unknown page size {v.upper!r} - try specifying (width, height) in cm")

                options["paperWidth"] = float(v[0]) * CM_TO_INCH
                options["paperHeight"] = float(v[1]) * CM_TO_INCH

            else:
                raise ValueError(f"Unknown option {k!r}")

        return options

    # Hacked-up responses
    def send_response(self, data):

        send_to_server({"id": self.id, "response": None,
                        "objects": [{"type": ["DataMedia"], "path": ["response"], "id": "pdf",
                                     "mime-type": "application/pdf", "name": self.filename}]})

        # Copied from _server.serialise()
        l = len(data)
        i = 0
        n = 0
        sent_once = False
        while i < l or not sent_once:
            chunk_len = min(l - i, 65536)

            send_to_server({'type': 'CHUNK_HEADER', 'requestId': self.id, 'mediaId': 'pdf',
                            'chunkIndex': n, 'lastChunk': (i + chunk_len == l)},
                           data[i:(i+chunk_len)])

            i += chunk_len
            n += 1
            sent_once = True

    def send_error(self, e):
        send_to_server({"id": self.id, "error": {"type": type(e).__name__, "message": "PDF generation failed: " + str(e)}})

    def send_exception(self, e):
        send_to_server({"id": self.id, "error": e})


def launch(data):
    print(f"Launching new browser for app {data['app-id']}")
    Browser(data)
