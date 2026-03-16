import { Jimp } from 'jimp';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function processIcon() {
  try {
    const inputPath = 'c:\\Users\\Danillo\\.gemini\\antigravity\\brain\\339930a8-cb0c-49c0-85ba-5eb5121d79d3\\media__1773618728499.png';
    const outputPath512 = path.join(__dirname, 'public', 'icons', 'Icon-512.png');
    const outputPath192 = path.join(__dirname, 'public', 'icons', 'Icon-192.png');

    console.log('Reading image:', inputPath);
    let logo = await Jimp.read(inputPath);
    
    logo = logo.autocrop({ tolerance: 0.05 }); 

    const bg512 = new Jimp({ width: 512, height: 512, color: '#ffffff' });
    
    logo.contain({ w: 430, h: 430 });
    
    const x = Math.floor((512 - logo.bitmap.width) / 2);
    const y = Math.floor((512 - logo.bitmap.height) / 2); 

    bg512.composite(logo, x, y);

    await bg512.write(outputPath512);

    const bg192 = bg512.clone();
    bg192.resize({ w: 192, h: 192 });
    await bg192.write(outputPath192);

    console.log('Icons generated successfully.');
  } catch (err) {
    console.error('Error generating icons:', err);
  }
}

processIcon();
