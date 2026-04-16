import { Jimp } from 'jimp';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function processIcon() {
  try {
    const inputPath = 'c:\\Users\\Danillo\\.gemini\\antigravity\\brain\\339930a8-cb0c-49c0-85ba-5eb5121d79d3\\media__1773618728499.png';
    const outputPath512 = path.join(__dirname, 'public', 'icons', 'Icon-512.png');
    const outputPath192 = path.join(__dirname, 'public', 'icons', 'Icon-192.png');

    console.log('Reading image for PWA Icons:', inputPath);
    let logo = await Jimp.read(inputPath);
    logo = logo.autocrop({ tolerance: 0.1 });

    // Work at 1024x1024 for super-sampling quality
    const SIZE = 1024;
    const CENTER = SIZE / 2;
    const RING_RADIUS = 490;   // outer radius of the black ring
    const RING_WIDTH = 110;    // double thickness of the black ring (was 55)

    // Create white background
    const canvas = new Jimp({ width: SIZE, height: SIZE, color: 0xFFFFFFFF });

    // Draw thick black ring with smooth anti-aliasing
    canvas.scan(0, 0, SIZE, SIZE, function(px, py, idx) {
      const dx = px - CENTER;
      const dy = py - CENTER;
      const dist = Math.sqrt(dx * dx + dy * dy);

      const innerEdge = RING_RADIUS - RING_WIDTH;
      const outerEdge = RING_RADIUS;

      if (dist >= innerEdge && dist <= outerEdge) {
        // Solid black ring
        this.bitmap.data[idx + 0] = 0;
        this.bitmap.data[idx + 1] = 0;
        this.bitmap.data[idx + 2] = 0;
        this.bitmap.data[idx + 3] = 255;
      } else if (dist < innerEdge && dist >= innerEdge - 2) {
        // Soft inner edge (anti-alias blending toward white)
        const t = (dist - (innerEdge - 2)) / 2;
        const v = Math.round(255 * t);
        this.bitmap.data[idx + 0] = 255 - v;
        this.bitmap.data[idx + 1] = 255 - v;
        this.bitmap.data[idx + 2] = 255 - v;
        this.bitmap.data[idx + 3] = 255;
      } else if (dist > outerEdge && dist <= outerEdge + 2) {
        // Soft outer edge (anti-alias)
        const t = (outerEdge + 2 - dist) / 2;
        const v = Math.round(255 * t);
        this.bitmap.data[idx + 0] = 255 - v;
        this.bitmap.data[idx + 1] = 255 - v;
        this.bitmap.data[idx + 2] = 255 - v;
        this.bitmap.data[idx + 3] = 255;
      }
      // else: stays white (already set by background)
    });

    // Composite logo centered inside the ring (logo ~80% of inner area)
    logo.contain({ w: Math.round((SIZE - RING_WIDTH * 2 - 40) * 0.805), h: Math.round((SIZE - RING_WIDTH * 2 - 40) * 0.805) });
    const lx = Math.floor((SIZE - logo.bitmap.width) / 2);
    const ly = Math.floor((SIZE - logo.bitmap.height) / 2);
    canvas.composite(logo, lx, ly);

    // Downscale to final sizes (creates natural anti-aliasing)
    canvas.resize({ w: 512, h: 512 });
    await canvas.write(outputPath512);
    console.log('Written Icon-512.png');

    const canvas192 = canvas.clone();
    canvas192.resize({ w: 192, h: 192 });
    await canvas192.write(outputPath192);
    console.log('Written Icon-192.png');

    // Also save the plain logo (unchanged, for internal app use)
    let logoInternal = await Jimp.read(inputPath);
    logoInternal = logoInternal.autocrop({ tolerance: 0.1 });
    await logoInternal.write(path.join(__dirname, 'public', 'logo_pegasus_sem_nome.png'));
    console.log('Icons generated: white background + thick black ring + centered logo');

  } catch (err) {
    console.error('Error:', err);
  }
}
processIcon();
