import { Alert, Collected, EMPTY, HOUR_MS } from "./types";

const TOKEN = () => process.env.GITHUB_TOKEN;
const USER  = () => process.env.GITHUB_USER;

const gh = (path: string) =>
  fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${TOKEN()}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    cache: "no-store",
  }).then(r => (r.ok ? r.json() : null)).catch(() => null);

/** Pedidos de review e falhas de CI/deploy no que foi mexido recentemente. `baseline`: só marca como visto. */
export async function collectGithub(seen: Set<string>, baseline: boolean): Promise<Collected> {
  if (!TOKEN() || !USER()) return EMPTY;
  const user = USER()!;
  const found: Alert[] = [];
  const until = () => Date.now() + 6 * HOUR_MS;

  const reviews = await gh(`/search/issues?${new URLSearchParams({ q: `is:pr is:open review-requested:${user}`, per_page: "5" })}`);
  for (const pr of reviews?.items ?? []) {
    const repo = String(pr.repository_url).split("/").slice(-1)[0];
    found.push({
      id: `gh:review:${pr.id}`, source: "github", priority: 0, until: until(),
      text: `Pediram seu review no PR ${pr.number}, ${pr.title}, do repositório ${repo}.`,
    });
  }

  const repos = await gh(`/users/${user}/repos?sort=pushed&per_page=5&type=owner`);
  const recent = (Array.isArray(repos) ? repos : []).filter(
    (r: { pushed_at: string }) => Date.now() - new Date(r.pushed_at).getTime() < 6 * HOUR_MS,
  );

  await Promise.all(recent.map(async (r: { name: string; default_branch: string }) => {
    const [status, checks] = await Promise.all([
      gh(`/repos/${user}/${r.name}/commits/${r.default_branch}/status`),
      gh(`/repos/${user}/${r.name}/commits/${r.default_branch}/check-runs?per_page=20`),
    ]);
    const sha: string | undefined = status?.sha ?? checks?.check_runs?.[0]?.head_sha;
    if (!sha) return;

    const failedStatus = (status?.statuses ?? []).find((s: { state: string }) => s.state === "failure" || s.state === "error");
    if (failedStatus) {
      found.push({
        id: `gh:status:${r.name}:${sha}`, source: "github", priority: 1, until: until(),
        text: `Atenção, o deploy do ${r.name} falhou na branch ${r.default_branch}.`,
      });
    }
    const failedCheck = (checks?.check_runs ?? []).find((c: { conclusion: string | null }) => c.conclusion === "failure");
    if (failedCheck) {
      found.push({
        id: `gh:ci:${r.name}:${sha}`, source: "github", priority: 1, until: until(),
        text: `O CI do ${r.name} falhou na branch ${r.default_branch}: ${failedCheck.name}.`,
      });
    }
  }));

  const fresh = found.filter(a => !seen.has(a.id));
  return baseline ? { alerts: [], mark: fresh.map(a => a.id) } : { alerts: fresh, mark: [] };
}
