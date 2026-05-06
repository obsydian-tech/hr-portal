from PIL import Image

NAVY = (22, 18, 77)
AMBER = (245, 158, 11)

def sample(path, label):
    img = Image.open(path).convert("RGB")
    w, h = img.size
    pixels = [img.getpixel((x, y)) for x in range(0, w, 4) for y in range(0, h, 4)]
    def near(p, ref, tol=25):
        return all(abs(p[i]-ref[i]) <= tol for i in range(3))
    navy = sum(1 for p in pixels if near(p, NAVY))
    amber = sum(1 for p in pixels if near(p, AMBER))
    total = len(pixels)
    print(f"\n{label}:")
    print(f"  Navy  #16124d: {navy:5d}/{total} ({100*navy/total:.1f}%)")
    print(f"  Amber #f59e0b: {amber:5d}/{total} ({100*amber/total:.1f}%)")

base = ".screenshots/"
sample(base+"01-dashboard-toggle.png", "Dashboard + Toggle")
sample(base+"03-panel-open.png", "Panel Open")
sample(base+"04-panel-closeup.png", "Panel Closeup")
sample(base+"05-card-grid-closeup.png", "Card Grid")
