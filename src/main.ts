import './design/tokens.css';
import './design/base.css';
import { mount } from 'svelte';
import App from './App.svelte';
import { themeStore } from './app/themeStore.svelte';
import { boot } from './app/boot.svelte';
import { registerServiceWorker } from './app/platform';

themeStore.init();
boot.track('fonts', document.fonts.ready, 1);
boot.track(
  'type faces',
  Promise.all([document.fonts.load('14px "Departure Mono"'), document.fonts.load('800 40px Archivo')]),
  1
);

const target = document.getElementById('app');
if (!target) throw new Error('#app missing');
mount(App, { target });
void registerServiceWorker();
