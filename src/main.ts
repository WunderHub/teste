import Phaser from 'phaser';
import { CombatScene } from './scene';
import './style.css';

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'battlefield',
  backgroundColor: '#414737',
  scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
  render: { antialias: true, pixelArt: false, roundPixels: false },
  input: { activePointers: 1 },
  scene: [CombatScene],
  audio: { noAudio: true },
});
