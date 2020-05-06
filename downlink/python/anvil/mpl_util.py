import matplotlib.pyplot as plt
import anvil
import io


#!defFunction(anvil.mpl_util,anvil.Media instance,[dpi=],[facecolor=],[edgecolor=],[format=],[transparent=],[frameon=],[bbox_inches=],[pad_inches=],[filename=])!2: "Return the current Matplotlib figure as an PNG image. Returns an Anvil Media object that can be displayed in Image components.\n\nOptional arguments have the same meaning as for 'savefig()'" ["plot_image"]
def plot_image(format='png', transparent=True, **kwargs):
  with io.BytesIO() as buf:
    plt.savefig(buf, format=format, transparent=transparent, **kwargs)
    buf.seek(0)    
    return anvil.BlobMedia('image/png', buf.read(), name=kwargs.get("filename", "plot.png"))
