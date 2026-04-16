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
    logo = logo.autocrop({ tolerance: 0.05 }); 

    const bg512 = new Jimp({ width: 512, height: 512, color: 0x00000000 });
    
    logo.contain({ w: 440, h: 440 });
    
    const x = Math.floor((512 - logo.bitmap.width) / 2);
    const y = Math.floor((512 - logo.bitmap.height) / 2); 
    bg512.composite(logo, x, y);

    const centerX = 256; const centerY = 256; const radius = 250; const thickness = 12;
    bg512.scan(0, 0, 512, 512, function(px, py, idx) {
      const dx = px - centerX; const dy = py - centerY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance >= radius - thickness && distance <= radius) {
        this.bitmap.data[idx + 0] = 0; this.bitmap.data[idx + 1] = 0;
        this.bitmap.data[idx + 2] = 0; this.bitmap.data[idx + 3] = 255;
      }
    });

    await bg512.write(outputPath512);
    const bg192 = bg512.clone();
    bg192.resize({ w: 192, h: 192 });
    await bg192.write(outputPath192);

    console.log('Icons generated successfully');
    
    let logoInternal = await Jimp.read(inputPath);
    logoInternal = logoInternal.autocrop({ tolerance: 0.05 });
    await logoInternal.write(path.join(__dirname, 'public', 'logo_pegasus_sem_nome.png'));

  } catch (err) {
    console.error('Error:', err);
  }
}
processIcon();
