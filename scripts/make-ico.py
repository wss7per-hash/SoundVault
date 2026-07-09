from PIL import Image
import sys

png_path = sys.argv[1]
ico_path = sys.argv[2]

img = Image.open(png_path).convert('RGBA')

sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]

# Pillow creates an ICO with the requested sizes from the source image
img.save(ico_path, format='ICO', sizes=sizes)
print(f'Saved {ico_path}')
