import { render } from 'preact';
import { App } from './app.jsx';
import { game } from './game.js';
import './style.css';

render(<App />, document.getElementById('app'));
game.start();
