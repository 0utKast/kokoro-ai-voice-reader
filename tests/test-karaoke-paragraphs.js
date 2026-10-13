/**
 * Test Suite: Karaoke Paragraph Structuring & Reflow Resilience
 */

import { splitTextIntoSmartChunks, splitTextIntoSentences, normalizeTextForSpeech } from '../src/shared/audio-utils.js';

let passed = 0;
let total = 0;

function assert(cond, msg) {
  total++;
  if (cond) {
    console.log(`  ✓ PASS: ${msg}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${msg}`);
    throw new Error(msg);
  }
}

console.log('====================================================');
console.log('🧪 VERIFICACIÓN DE ESTRUCTURACIÓN DE PÁRRAFOS KARAOKE');
console.log('====================================================\n');

// Test 1: Single paragraph with multiple sentences
console.log('🔹 Test 1: Párrafo individual con múltiples oraciones');
{
  const text = 'Esta es la primera frase del párrafo uno. Aquí viene la segunda frase que complementa la idea. Finalmente la tercera frase cierra el párrafo.';
  const chunks = splitTextIntoSmartChunks(text, { firstChunkTarget: 100, normalChunkTarget: 150 });
  
  assert(chunks.length >= 1, `Generados ${chunks.length} chunks`);
  assert(chunks.every(c => c.paragraphIndex === 0), 'Todos los chunks pertenecen al párrafo 0');
  assert(chunks[chunks.length - 1].isParagraphEnd === true, 'El último chunk está marcado como fin de párrafo');
}

// Test 2: Multi-paragraph text preservation
console.log('\n🔹 Test 2: Texto con múltiples párrafos');
{
  const text = `Primer párrafo que introduce el concepto principal con claridad y detalle.

Segundo párrafo que profundiza en la temática abordada con argumentos sólidos.

Tercer y último párrafo de conclusiones y reflexiones finales.`;

  const chunks = splitTextIntoSmartChunks(text);
  assert(chunks.length >= 3, `Generados ${chunks.length} chunks para 3 párrafos`);
  
  const pIndices = [...new Set(chunks.map(c => c.paragraphIndex))];
  assert(pIndices.length === 3, 'Se identificaron exactamente 3 párrafos distintos');
  assert(pIndices[0] === 0 && pIndices[1] === 1 && pIndices[2] === 2, 'Los índices de párrafo son secuenciales (0, 1, 2)');
  
  // Verify paragraph ends
  const para0Chunks = chunks.filter(c => c.paragraphIndex === 0);
  assert(para0Chunks[para0Chunks.length - 1].isParagraphEnd === true, 'Párrafo 0 finaliza correctamente');

  const para1Chunks = chunks.filter(c => c.paragraphIndex === 1);
  assert(para1Chunks[para1Chunks.length - 1].isParagraphEnd === true, 'Párrafo 1 finaliza correctamente');

  const para2Chunks = chunks.filter(c => c.paragraphIndex === 2);
  assert(para2Chunks[para2Chunks.length - 1].isParagraphEnd === true, 'Párrafo 2 finaliza correctamente');
}

// Test 3: Simulation of DOM paragraph grouping
console.log('\n🔹 Test 3: Simulación de agrupación DOM para Karaoke');
{
  const text = `Párrafo 1 oracion A. Párrafo 1 oracion B. Párrafo 1 oracion C.

Párrafo 2 oracion D. Párrafo 2 oracion E.`;

  const chunks = splitTextIntoSmartChunks(text, { firstChunkTarget: 50, normalChunkTarget: 50 });
  
  // Replicate app.js paragraphsMap grouping
  const paragraphsMap = new Map();
  chunks.forEach((chunk, idx) => {
    const pIdx = chunk.paragraphIndex ?? 0;
    if (!paragraphsMap.has(pIdx)) paragraphsMap.set(pIdx, []);
    paragraphsMap.get(pIdx).push({ text: chunk.text, index: idx });
  });

  assert(paragraphsMap.size === 2, 'El DOM agrupa los chunks exactamente en 2 párrafos');
  assert(paragraphsMap.get(0).length >= 1, 'Párrafo 0 contiene sus frases correspondientes');
  assert(paragraphsMap.get(1).length >= 1, 'Párrafo 1 contiene sus frases correspondientes');

  // Verify full text integrity
  const combinedP0 = paragraphsMap.get(0).map(c => c.text).join(' ');
  assert(combinedP0.includes('oracion A') && combinedP0.includes('oracion C'), 'Párrafo 0 conserva todo su contenido textual íntegro');
}

// Test 4: Protección de abreviaturas bilingües (ES/EN) e iniciales
console.log('\n🔹 Test 4: Protección de abreviaturas en español/inglés e iniciales de nombres');
{
  const enText = 'Mr. Smith and Mrs. Jones met Dr. J. K. Rowling at St. Pancras Station in the U.S.A. Then they discussed classic literature.';
  const sentences = splitTextIntoSentences(enText);
  assert(sentences.length === 2, `El texto en inglés con abreviaturas e iniciales se divide exactamente en 2 oraciones (obtenido: ${sentences.length})`);
  assert(sentences[0].includes('Mr. Smith') && sentences[0].includes('J. K. Rowling') && sentences[0].includes('St. Pancras'), 'La primera oración preserva Mr., Mrs., Dr., J. K. y St. sin cortes prematuros');
}

console.log('\n====================================================');
console.log(`🎉 PRUEBAS DE KARAOKE: ${passed} / ${total} EXITOSAS`);
console.log('====================================================\n');
