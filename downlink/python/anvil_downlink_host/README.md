# Downlink Host

## PDF Renderer Sandboxing

We use minijail0 to run ps2pdf inside a sandbox with minimal permissions. In some circumstances (e.g. when the container OS is upgraded) it might be necessary to update the seccomp policy.

You'll know you might need to do this if you see errors like `libminijail[204]: child process 205 exited with status 254`.

The easiest way to update the policy is by running the minijail0 command inside strace in the container. You should see it fail when attempting a syscall that is not in the policy list. Add it to the policy and try again until you have the necessary syscalls added.

For example:

```bash
docker run docker run --privileged -v ~/input.pdf:/input.pdf -it anvil.works:4455/public/anvil-pdf-renderer bash

# Inside the container

# First check that the ps2pdf command works
/usr/bin/ps2pdf -dPDFSETTINGS=/screen /input.pdf - > out.pdf

# Try in the minijail (fails)
mkdir -p /tmp/working/tmp
minijail0 --logging=stderr -u nobody -l -p --uts -N -P /tmp/working -t \
  -b /usr -b /bin -b /lib -b /lib64 -b /etc -b /dev/urandom -b /input.pdf \
  -S anvil_downlink_host/ps2pdf-seccomp.policy \
  /usr/bin/ps2pdf -dPDFSETTINGS=/screen /input.pdf - > out.pdf

# libminijail[106]: child process 107 exited with status 254

# Use strace to see which syscall is failing

strace -f minijail0 --logging=stderr -u nobody -l -p --uts -N -P /tmp/working -t \
  -b /usr -b /bin -b /lib -b /lib64 -b /etc -b /dev/urandom -b /input.pdf \
  -S anvil_downlink_host/ps2pdf-seccomp.policy \
  /usr/bin/ps2pdf -dPDFSETTINGS=/screen /input.pdf - > out.pdf

# ...
# [pid   153] faccessat2(AT_FDCWD, "/usr/bin/ps2pdf14", X_OK, AT_EACCESS) = 439
# [pid   153] +++ killed by SIGSYS (core dumped) +++

# Add `faccessat2: 1` to `anvil_downlink_host/ps2pdf-seccomp.policy` and try again:

strace -f minijail0 --logging=stderr -u nobody -l -p --uts -N -P /tmp/working -t \
  -b /usr -b /bin -b /lib -b /lib64 -b /etc -b /dev/urandom -b /input.pdf \
  -S anvil_downlink_host/ps2pdf-seccomp.policy \
  /usr/bin/ps2pdf -dPDFSETTINGS=/screen /input.pdf - > out.pdf

# exit_group(0)                           = ?
# +++ exited with 0 +++
```
