from anvil_downlink_host import workers_by_id, send_with_header
from . import worker_cache


def launch(data):
    type = data.get("type")
    id = data.get("id")


    is_background_task = type == "LAUNCH_BACKGROUND"
    is_repl_launch = type == "LAUNCH_REPL"

    print ("%s '%s' for app '%s' (ID %s)" % ("Launching REPL" if is_repl_launch else "Launching BG task" if is_background_task else "Calling function",
                                             data.get("command", "<no func>"), data.get("app-id", "<unknown>"), id))

    if data.get('command') == "anvil.private.pdf.get_component" and not is_background_task:
        wid = data['args'][0][0]
        worker = workers_by_id.get(wid)
        if worker is None:
            send_with_header({'id': id, 'error': {'message': "No component worker found for print call '%s'" % wid}})
            return
        else:
            worker.send(data)

    else:
        worker_cache.handle(data)
