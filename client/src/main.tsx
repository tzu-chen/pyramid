import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ThemeProvider } from './contexts/ThemeContext';
import { EditorFontSizeProvider } from './contexts/EditorFontSizeContext';
import { EditorVimModeProvider } from './contexts/EditorVimModeContext';
import { PowerSaverProvider } from './contexts/PowerSaverContext';
import { KeybindingsProvider } from './contexts/KeybindingsContext';
import { FullscreenProvider } from './contexts/FullscreenContext';
import App from './App';
import './styles/global.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <EditorFontSizeProvider>
          <EditorVimModeProvider>
            <PowerSaverProvider>
              <KeybindingsProvider>
                <FullscreenProvider>
                  <App />
                </FullscreenProvider>
              </KeybindingsProvider>
            </PowerSaverProvider>
          </EditorVimModeProvider>
        </EditorFontSizeProvider>
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>
);
