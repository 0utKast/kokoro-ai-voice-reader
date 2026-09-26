import zlib
import struct
import math
import os

def create_png(width, height, pixels):
    """
    Creates a PNG bytearray from RGBA pixel data.
    pixels: list of bytearrays or bytes, each row of length width * 4.
    """
    def chunk(tag, data):
        crc = zlib.crc32(tag + data) & 0xffffffff
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', crc)

    header = b'\x89PNG\r\n\x1a\n'
    ihdr = chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0))
    
    raw_data = bytearray()
    for row in pixels:
        raw_data.append(0) # Filter type 0 (None)
        raw_data.extend(row)
        
    idat = chunk(b'IDAT', zlib.compress(bytes(raw_data), 9))
    iend = chunk(b'IEND', b'')
    return header + ihdr + idat + iend

def generate_kokoro_icon(size):
    pixels = []
    radius = size * 0.22
    center_y = size / 2.0
    
    # 5 soundwave bars parameters
    bar_count = 5
    bar_width = max(1.0, size * 0.10)
    bar_spacing = max(1.0, size * 0.05)
    total_w = bar_count * bar_width + (bar_count - 1) * bar_spacing
    start_x = (size - total_w) / 2.0
    bar_heights = [0.35, 0.65, 0.95, 0.60, 0.38]

    for y in range(size):
        row = bytearray()
        for x in range(size):
            # Check rounded rectangle distance
            dx = max(radius - x, 0, x - (size - 1 - radius))
            dy = max(radius - y, 0, y - (size - 1 - radius))
            dist = math.sqrt(dx * dx + dy * dy)
            
            if dist > radius:
                # Outside icon bounds (transparent)
                row.extend([0, 0, 0, 0])
                continue
                
            # Antialiasing on border
            alpha_edge = 1.0
            if dist > radius - 1.0:
                alpha_edge = max(0.0, radius - dist)
                
            # Background Gradient: Vibrant Violet (#6C3BE8) -> Electric Blue (#1E88E5) -> Teal (#00E5FF)
            t = (x + y) / (2.0 * size)
            r_bg = int((1.0 - t) * 108 + t * 0)
            g_bg = int((1.0 - t) * 59 + t * 229)
            b_bg = int((1.0 - t) * 232 + t * 255)
            
            # Check if inside any soundwave bar
            inside_bar = False
            for i in range(bar_count):
                bx = start_x + i * (bar_width + bar_spacing)
                bh = (size * bar_heights[i]) * 0.62
                by_min = center_y - bh / 2.0
                by_max = center_y + bh / 2.0
                br = bar_width / 2.0
                
                # Check rounded bar
                if bx <= x <= bx + bar_width and by_min <= y <= by_max:
                    # check caps
                    if y < by_min + br:
                        cdist = math.hypot(x - (bx + br), y - (by_min + br))
                        if cdist <= br:
                            inside_bar = True
                            break
                    elif y > by_max - br:
                        cdist = math.hypot(x - (bx + br), y - (by_max - br))
                        if cdist <= br:
                            inside_bar = True
                            break
                    else:
                        inside_bar = True
                        break
            
            if inside_bar:
                # White bar
                r, g, b, a = 255, 255, 255, int(255 * alpha_edge)
            else:
                r, g, b, a = r_bg, g_bg, b_bg, int(255 * alpha_edge)
                
            row.extend([r, g, b, a])
        pixels.append(row)
        
    return create_png(size, size, pixels)

os.makedirs('icons', exist_ok=True)
for s in [16, 32, 48, 128]:
    png_bytes = generate_kokoro_icon(s)
    path = f'icons/icon-{s}.png'
    with open(path, 'wb') as f:
        f.write(png_bytes)
    print(f"Generated {path} ({s}x{s}, {len(png_bytes)} bytes)")
