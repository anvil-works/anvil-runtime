from anvil import *

class Form1Template(HtmlPanel):

  def init_components(self, **properties):
  	# Initialise HtmlPanel
    super().__init__() 
    # Set the html template for the app
    self.html = '@theme:standard-page.html'

    # Add a GridPanel to the Form
    self.content_panel = GridPanel()
    self.add_component(self.content_panel)

    # Add a FlowPanel to accept NavBar links
    self.nav_links = FlowPanel()
    self.add_component(self.nav_links, slot="nav-right")

    # Add a title to the app
    self.title_label = Label(text="My App")
    self.add_component(self.title_label, slot="title")

    # Add a sidebar to the app. Comment out the following two rows if you don't want a sidebar in your app.
    self.left_nav = ColumnPanel()
    self.add_component(self.left_nav, slot="left-nav")



