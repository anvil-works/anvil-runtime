import anvil.server

#def charge(token, amount, currency):
#    return anvil.server.call("anvil.private.stripe.charge", amount, currency)

def subscribe_new_customer(token, email_address, plan, quantity=1):
    customer = anvil.server.call("anvil.private.stripe.new_customer", email_address, token)
    customer.subscribe(plan, quantity)
    return customer

#!defFunction(anvil.stripe,stripe..Customer instance,email_address,[token])!2: "Create a new Stripe Customer record" ["new_customer"]
def new_customer(email_address, token=None):
    return anvil.server.call("anvil.private.stripe.new_customer", email_address, token)

#!defFunction(anvil.stripe,stripe..Customer instance,customer_id)!2: "Retrieve a Stripe Customer record by its ID" ["get_customer"]
def get_customer(customer_id):
    return anvil.server.call("anvil.private.stripe.get_customer", customer_id)


# Virtual definitions of live-object types
#!defMethod(list[stripe..Subscription instance],[live_only])!2: "List all current subscriptions for this user.\n\nBy default, only returns live subscriptions" ["get_subscriptions"]
#!defMethod(list[str instance],[live_only])!2: "List the string ID for each current subscriptions for this user" ["get_subscription_ids"]
#!defMethod(stripe..Subscription instance,plan_id,[quantity])!2: "Subscribe this user to the specified plan (quantity defaults to 1)" ["new_subscription"]
#!defMethod(_,token)!2: "Add the specified token as a payment method for this customer" ["add_token"]
#!defMethod(_,amount,currency)!2: "Issue a one-off charge to this customer" ["charge"]
#!defClass(stripe.,Customer)!:


#!defMethod(_)!2: "Returns True if this subscription's status is 'active', 'trialling', or 'past_due'" ["is_live"]
#!defMethod(_,[at_period_end=True])!2: "Cancel this subscription.\nBy default, at_period_end=True, meaning the subscription will be cancelled at the end of the current billing period, with no credit or refund." ["cancel"]
#!defMethod(_,plan_id)!2: "Set this subscription to the specified Stripe plan" ["set_plan"]
#!defClass(stripe.,Subscription)!:

