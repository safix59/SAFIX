/**
 * GLB Trim — supprime un node nommé d'un fichier GLB.
 * Usage : node glb-trim.mjs input.glb output.glb iphone17promax001
 */
import { NodeIO } from '@gltf-transform/core';
import { prune, dedup } from '@gltf-transform/functions';

const [,, inputPath, outputPath, nodeName] = process.argv;
if (!inputPath || !outputPath || !nodeName) {
  console.error('Usage: node glb-trim.mjs <input.glb> <output.glb> <nodeName>');
  process.exit(1);
}

const io = new NodeIO();
const doc = await io.read(inputPath);
const root = doc.getRoot();

// Liste tous les nodes pour info
const allNodes = root.listNodes();
console.log('Nodes trouvés :');
allNodes.forEach(n => console.log('  -', n.getName() || '(unnamed)'));

// Trouve le node à supprimer
const target = allNodes.find(n => n.getName() === nodeName);
if (!target) {
  console.error('❌ Node introuvable :', nodeName);
  process.exit(1);
}

// Approche douce : on cache juste le node au lieu de le supprimer
// → préserve les ressources partagées entre les meshes
// Méthode : on détache le node du graphe scène (mais sans dispose)
const scenes = root.listScenes();
scenes.forEach(scene => {
  if (scene.listChildren().includes(target)) {
    scene.removeChild(target);
  }
});
allNodes.forEach(parent => {
  if (parent !== target && parent.listChildren().includes(target)) {
    parent.removeChild(target);
  }
});

// PAS de dispose, PAS de prune. On garde toutes les ressources accessibles
// pour les autres meshes qui pourraient les partager.
console.log('  → node détaché de la scène (ressources préservées)');

// Écrit le résultat
await io.write(outputPath, doc);

// Stats
const before = (await io.readBinary(await io.writeBinary(await io.read(inputPath)))).byteLength;
const after = (await io.writeBinary(doc)).byteLength;
console.log(`\n✓ Sauvegardé : ${outputPath}`);
console.log(`  Taille avant : ${(before/1024).toFixed(0)} KB`);
console.log(`  Taille après : ${(after/1024).toFixed(0)} KB`);
console.log(`  Réduction : ${((1 - after/before) * 100).toFixed(1)}%`);
