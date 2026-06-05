import styles from './Badge.module.css';

export type BadgeVariant =
  | 'default'
  | 'freeform'
  | 'python'
  | 'cpp'
  | 'ocaml'
  | 'julia'
  | 'lean'
  | 'notebook'
  | 'success'
  | 'warning'
  | 'danger';

interface BadgeProps {
  label: string;
  variant?: BadgeVariant;
}

function Badge({ label, variant = 'default' }: BadgeProps) {
  return (
    <span className={`${styles.badge} ${styles[variant]}`}>
      {label}
    </span>
  );
}

export default Badge;
