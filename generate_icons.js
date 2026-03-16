import { Jimp } from 'jimp';

async function processIcon() {
  try {
    const inputPath = 'c:\\Users\\Danillo\\.gemini\\antigravity\\brain\\339930a8-cb0c-49c0-85ba-5eb5121d79d3\\media__1773618728499.png';
    const outputPath512 = 'public/icons/Icon-512.png';
    const outputPath192 = 'public/icons/Icon-192.png';

    console.log('Reading image:', inputPath);
    const logo = await Jimp.read(inputPath);
    
    // Resize the logo to fit nicely within a padded 512x512 space
    // and composite to a new white background
    const bg512 = new Jimp({ width: 512, height: 512, color: '#ffffff' });
    
    // make logo size max 440 or so
    logo.contain({ w: 450, h: 450 });
    
    bg512.composite(logo, 31, 46); // shifted down

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
