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

    const bg512 = new Jimp({ width: 512, height: 512, color: '#ffffff' });
    
    // Diminui 10% para o ícone da área de trabalho
    logo.contain({ w: 380, h: 380 });
    
    const x = Math.floor((512 - logo.bitmap.width) / 2);
    const y = Math.floor((512 - logo.bitmap.height) / 2); 
    bg512.composite(logo, x, y);

    // Desenha o círculo preto apenas para o ícone externo
    const centerX = 256; const centerY = 256; const radius = 220; const thickness = 6;
    bg512.scan(0, 0, 512, 512, function(px, py, idx) {
      const dx = px - centerX; const dy = py - centerY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance >= radius - thickness && distance <= radius + thickness) {
        this.bitmap.data[idx + 0] = 0; this.bitmap.data[idx + 1] = 0;
        this.bitmap.data[idx + 2] = 0; this.bitmap.data[idx + 3] = 255;
      }
    });

    await bg512.write(outputPath512);
    const bg192 = bg512.clone();
    bg192.resize({ w: 192, h: 192 });
    await bg192.write(outputPath192);

    console.log('? Ícones de instalação (PWA) gerados com círculo!');
    
    // RESTAURAR LOGO INTERNA: Sem círculo e tamanho original
    let logoInternal = await Jimp.read(inputPath);
    logoInternal = logoInternal.autocrop({ tolerance: 0.05 });
    await logoInternal.write(path.join(__dirname, 'public', 'logo_pegasus_sem_nome.png'));
    console.log('? Logo interna restaurada ao padrão original!');

  } catch (err) {
    console.error('Erro:', err);
  }
}
processIcon();
