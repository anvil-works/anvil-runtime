import anvil.server

#!defClass(anvil.users,UserExists)!:
class UserExists(anvil.server.AnvilWrappedError):
    pass


#!defClass(anvil.users,AuthenticationFailed)!:
class AuthenticationFailed(anvil.server.AnvilWrappedError):
    pass


#!defClass(anvil.users,EmailNotConfirmed)!:
class EmailNotConfirmed(AuthenticationFailed):
    pass


#!defClass(anvil.users,AccountIsNotEnabled)!:
class AccountIsNotEnabled(AuthenticationFailed):
    pass


#!defClass(anvil.users,TooManyPasswordFailures)!:
class TooManyPasswordFailures(AuthenticationFailed):
    pass


#!defClass(anvil.users,PasswordNotAcceptable)!:
class PasswordNotAcceptable(anvil.server.AnvilWrappedError):
    pass

#!defClass(anvil.users,MFARequired)!:
class MFARequired(AuthenticationFailed):
    pass

#!defClass(anvil.users,PasswordResetRequested)!:
class PasswordResetRequested(anvil.server.AnvilWrappedError):
    pass

