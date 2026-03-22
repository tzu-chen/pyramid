import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { RepoExploration } from '../../types';
import { repoService } from '../../services/repoService';
import Badge from '../../components/Badge/Badge';
import styles from './RepoListPage.module.css';

function RepoListPage() {
  const [repos, setRepos] = useState<RepoExploration[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    repoService.list().then(data => {
      setRepos(data);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Repo Explorations</h1>
        <Link to="/sessions/new" className={styles.createButton}>New Repo Session</Link>
      </div>

      {loading ? (
        <div className={styles.loading}>Loading...</div>
      ) : repos.length === 0 ? (
        <div className={styles.empty}>No repo explorations yet. Create a repo session to get started.</div>
      ) : (
        <div className={styles.repoList}>
          {repos.map(repo => (
            <Link key={repo.id} to={`/sessions/${repo.session_id}`} className={styles.repoCard}>
              <div className={styles.repoInfo}>
                <div className={styles.repoName}>{repo.repo_name}</div>
                <div className={styles.repoMeta}>
                  <Badge label="repo" variant="repo" />
                  <span className={styles.repoBranch}>{repo.branch}</span>
                  {repo.session_status && (
                    <Badge label={repo.session_status} variant={repo.session_status === 'active' ? 'success' : 'default'} />
                  )}
                </div>
                {repo.readme_summary && (
                  <p className={styles.repoSummary}>{repo.readme_summary}</p>
                )}
              </div>
              <span className={styles.repoDate}>
                {new Date(repo.created_at).toLocaleDateString()}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export default RepoListPage;
