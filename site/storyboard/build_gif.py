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
DELAYS = [200, 90, 110, 50, 90, 130, 180, 100, 160, 220]


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

	# One palette sampled from every frame. Pillow would repaint later frames
	# with the title card's greys and turn the candies muddy.
	listing = FRAMES / "frames.txt"
	lines = ["ffconcat version 1.0"]
	for scene, delay in zip(SCENES, DELAYS):
		lines.append(f"file '{scene}.png'")
		lines.append(f"duration {delay / 100:.2f}")
	lines.append(f"file '{SCENES[-1]}.png'")
	listing.write_text("\n".join(lines) + "\n", encoding="utf-8")
	palette = FRAMES / "palette.png"
	gif = OUT / "candy.gif"
	subprocess.run(
		["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(listing),
		 "-vf", "palettegen=stats_mode=full:max_colors=256", str(palette)],
		check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
	)
	subprocess.run(
		["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(listing), "-i", str(palette),
		 "-lavfi", "[0:v][1:v]paletteuse=dither=floyd_steinberg:diff_mode=rectangle",
		 "-loop", "0", str(gif)],
		check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
	)
	print(f"{gif} {gif.stat().st_size}")


if __name__ == "__main__":
	main()
