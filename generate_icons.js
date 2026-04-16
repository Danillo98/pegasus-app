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

    // SUPER-SAMPLING para evitar pixelamento (Gera em 1024 e redimensiona para 512)
    const bg1024 = new Jimp({ width: 1024, height: 1024, color: 0x00000000 });
    
    const centerX = 512; const centerY = 512; 
    const radius = 500; // Quase na borda
    const thickness = 28; // Espessura da borda preta
    const antiAlias = 4;  // Pixels de suavização na borda

    // Desenha o círculo preto com anti-aliasing manual
    bg1024.scan(0, 0, 1024, 1024, function(px, py, idx) {
      const dx = px - centerX; const dy = py - centerY;
      const distance = Math.sqrt(dx * dx + dy * dy);

      const innerEdge = radius - thickness;
      const outerEdge = radius;

      if (distance >= innerEdge - antiAlias && distance <= outerEdge + antiAlias) {
        let alpha = 255;
        // Suavização na borda interna
        if (distance < innerEdge) {
          alpha = Math.round(255 * ((distance - (innerEdge - antiAlias)) / antiAlias));
        }
        // Suavização na borda externa
        if (distance > outerEdge - antiAlias) {
          alpha = Math.round(255 * ((outerEdge + antiAlias - distance) / antiAlias));
        }
        alpha = Math.max(0, Math.min(255, alpha));
        // Apenas pinta se o alpha for significativo e o pixel for dentro da faixa
        if (distance >= innerEdge && distance <= outerEdge) {
          this.bitmap.data[idx + 0] = 0;   // R
          this.bitmap.data[idx + 1] = 0;   // G
          this.bitmap.data[idx + 2] = 0;   // B
          this.bitmap.data[idx + 3] = 255; // A (opaco)
        } else {
          // anti-aliasing edges - blend with existing
          const existing = this.bitmap.data[idx + 3];
          this.bitmap.data[idx + 0] = 0;
          this.bitmap.data[idx + 1] = 0;
          this.bitmap.data[idx + 2] = 0;
          this.bitmap.data[idx + 3] = Math.max(existing, alpha);
        }
      }
    });

    // Logo centralizada (80% do espaço) sobre o círculo
    logo.contain({ w: 820, h: 820 });
    const lx = Math.floor((1024 - logo.bitmap.width) / 2);
    const ly = Math.floor((1024 - logo.bitmap.height) / 2); 
    bg1024.composite(logo, lx, ly);

    // Redimensiona para o tamanho final (isso cria o anti-aliasing natural)
    bg1024.resize({ w: 512, h: 512 });
    await bg1024.write(outputPath512);

    const bg192 = bg1024.clone();
    bg192.resize({ w: 192, h: 192 });
    await bg192.write(outputPath192);

    console.log('Icons regenerated with border ring style and anti-aliasing');
    
    let logoInternal = await Jimp.read(inputPath);
    logoInternal = logoInternal.autocrop({ tolerance: 0.1 });
    await logoInternal.write(path.join(__dirname, 'public', 'logo_pegasus_sem_nome.png'));

  } catch (err) {
    console.error('Error:', err);
  }
}
processIcon();
