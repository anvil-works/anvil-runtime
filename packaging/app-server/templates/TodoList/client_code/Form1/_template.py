from anvil import *
from .ItemTemplate1 import ItemTemplate1


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
    self.title_label = Label(text="My CRUD App")
    self.add_component(self.title_label, slot="title")

    # Add a sidebar to the app. Comment out the following two rows if you don't want a sidebar in your app.
    #self.left_nav = ColumnPanel()
    #self.add_component(self.left_nav, slot="left-nav")

    # Create a DataGrid
    self.tasks_grid = DataGrid()

    # Add two columns to the Data Grid
    self.tasks_grid.columns = [
      { "id": "A", "title": "Task name", "data_key": "name" },
      { "id": "B", "title": "Completed", "data_key": "complete", "width": 100 },
      { "id": "C", "title": "Delete task", "data_key": "", "width": 90 }
    ]

    # Limit DataGrid to 8 rows per page
    self.tasks_grid.rows_per_page = 8

    # Create a RepeatingPanel, and set its item_template to our ItemTemplate1 
    self.tasks_panel = RepeatingPanel(item_template=ItemTemplate1)

    # Add the RepeatingPanel to your data grid
    self.tasks_grid.add_component(self.tasks_panel)

    # Set an event handler on the RepeatingPanel, to be raised by the ItemTemplate if a task is being deleted
    self.tasks_panel.set_event_handler('x-delete-task', self.delete_task)
    
    # Create a headline
    self.heading_1 = Label(text="Tasks", role="headline")
    self.content_panel.add_component(self.heading_1, row="A", col_sm=2, width_sm=8)

    # Create a Card 
    self.card_1 = GridPanel(role="card")
    # Add the DataGrid to the Card
    self.card_1.add_component(self.tasks_grid)
    # Add the Card to the content_panel
    self.content_panel.add_component(self.card_1, row="B", col_sm=2, width_sm=8)


    self.content_panel.add_component(Label(text="New task", role="headline", spacing_above="large"),
                                      row="C", col_sm=2, width_sm=8)

    self.card_2 = self.card_1 = GridPanel(role="card")
    self.add_task_panel = FlowPanel(align="center")
    self.card_2.add_component(self.add_task_panel,
                                      row="A", col_sm=2, width_sm=8)

    # Create a TextBox for adding a new task
    self.new_task_box = TextBox(placeholder="Buy Milk", width=400)
    # Create a Button for adding a new task
    self.add_task_button = Button(text="Add task", role="primary-color", icon="fa:plus-circle")
    self.add_task_panel.add_component(self.new_task_box)
    self.add_task_panel.add_component(self.add_task_button)
    self.content_panel.add_component(self.card_2, row="D", col_sm=2, width_sm=8)

    






