import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ThemeProvider } from './contexts/ThemeContext';
import { EditorFontSizeProvider } from './contexts/EditorFontSizeContext';
import App from './App';
import './styles/global.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <EditorFontSizeProvider>
          <App />
        </EditorFontSizeProvider>
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>
);
