"""Render the Candy Crush storyboard and write site/public/shots/candy.gif."""

from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
import os
import subprocess
import threading
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent
OUT = ROOT.parent / "public" / "shots"
FRAMES = ROOT / "frames"
CHROME = Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe")
SCENES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
# hundredths of a second, matching the beats of the story
DELAYS = [200, 90, 110, 50, 90, 130, 180, 110, 100, 150]


def main() -> None:
	FRAMES.mkdir(exist_ok=True)
	os.chdir(ROOT)
	server = ThreadingHTTPServer(("127.0.0.1", 8791), SimpleHTTPRequestHandler)
	threading.Thread(target=server.serve_forever, daemon=True).start()
	try:
		for scene in SCENES:
			target = FRAMES / f"{scene}.png"
			url = f"http://127.0.0.1:8791/candy.html?scene={scene}"
			subprocess.run(
				[
					str(CHROME),
					"--headless=new",
					"--disable-gpu",
					"--hide-scrollbars",
					"--force-device-scale-factor=1",
					"--window-size=1280,720",
					f"--screenshot={target}",
					url,
				],
				check=True,
				stdout=subprocess.DEVNULL,
				stderr=subprocess.DEVNULL,
			)
			with Image.open(target) as shot:
				if shot.size != (1280, 720):
					shot = shot.crop((0, 0, 1280, 720)) if shot.width >= 1280 else shot.resize((1280, 720))
					shot.save(target)
	finally:
		server.shutdown()

	images = [Image.open(FRAMES / f"{scene}.png").convert("RGB") for scene in SCENES]
	palette = images[0].quantize(colors=128, method=Image.Quantize.MEDIANCUT)
	frames = [im.quantize(palette=palette, dither=Image.Dither.NONE) for im in images]
	gif = OUT / "candy.gif"
	frames[0].save(
		gif,
		save_all=True,
		append_images=frames[1:],
		duration=[d * 10 for d in DELAYS],
		loop=0,
		optimize=True,
		disposal=2,
	)
	print(f"{gif} {gif.stat().st_size}")


if __name__ == "__main__":
	main()
