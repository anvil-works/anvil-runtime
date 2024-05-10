# A stub of the client-side anvil.designer module

def _err_func(*args, **kws):
    raise Exception("You cannot use anvil.designer in server modules")


in_designer = False

get_design_name = _err_func
update_component_properties = _err_func
update_component_sections = _err_func
start_editing_subform = _err_func
start_editing_form = _err_func
register_interaction = _err_func
notify_interactions_changed = _err_func
get_design_component = lambda x: x
request_form_property_change = _err_func
start_inline_editing = _err_func
