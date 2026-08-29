import { mountApp } from './app/app.component';

const root = document.getElementById('app');
if (!root) {
    throw new Error('Root element #app not found');
}

const dispose = mountApp(root);

window.addEventListener('beforeunload', () => {
    dispose();
});
