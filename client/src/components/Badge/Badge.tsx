import styles from './Badge.module.css';

interface BadgeProps {
  label: string;
  variant?: 'default' | 'freeform' | 'lean' | 'notebook' | 'success' | 'warning' | 'danger';
}

function Badge({ label, variant = 'default' }: BadgeProps) {
  return (
    <span className={`${styles.badge} ${styles[variant]}`}>
      {label}
    </span>
  );
}

export default Badge;
