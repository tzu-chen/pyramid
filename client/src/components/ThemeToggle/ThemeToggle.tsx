import { useTheme } from '../../contexts/ThemeContext';
import styles from './ThemeToggle.module.css';

function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();

  return (
    <button className={styles.toggle} onClick={toggleTheme} title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}>
      <span className={styles.icon}>{theme === 'light' ? 'Dark' : 'Light'}</span>
    </button>
  );
}

export default ThemeToggle;
