/**
 * Start-up tasks behind the preloader's progress bar: storage, the inference worker and the
 * model the first game uses (downloaded first, on a website that installs its models by itself).
 * Progress is weighted; a long task can report how far it got.
 */

interface Task {
  name: string;
  weight: number;
  done: boolean;
  /** 0..1 while running, for tasks that report it. */
  fraction: number;
}

class Boot {
  private tasks: Task[] = [];
  private settled: Promise<void>[] = [];
  progress = $state(0);
  errors = $state<string[]>([]);
  /** Storage is open and settings are loaded: screens that read saved data may mount. */
  dataReady = $state(false);

  track<T>(name: string, work: Promise<T>, weight = 1): Promise<T> {
    const task: Task = { name, weight, done: false, fraction: 0 };
    this.tasks.push(task);
    this.update();
    const finish = () => {
      task.done = true;
      this.update();
    };
    this.settled.push(
      work.then(finish, (err: unknown) => {
        this.errors = [...this.errors, `${name}: ${err instanceof Error ? err.message : String(err)}`];
        finish();
      })
    );
    return work;
  }

  /** How far a running task got (0..1); finished tasks count in full regardless. */
  partial(name: string, fraction: number): void {
    const task = this.tasks.find((t) => t.name === name && !t.done);
    if (!task) return;
    task.fraction = Math.min(1, Math.max(0, fraction));
    this.update();
  }

  /** Resolves when every task registered so far has settled (success or failure). */
  async ready(): Promise<void> {
    let n = -1;
    // Tasks may register more tasks while settling.
    while (n !== this.settled.length) {
      n = this.settled.length;
      await Promise.all(this.settled);
    }
  }

  private update(): void {
    const total = this.tasks.reduce((s, t) => s + t.weight, 0);
    const done = this.tasks.reduce((s, t) => s + t.weight * (t.done ? 1 : t.fraction), 0);
    this.progress = total ? done / total : 0;
  }
}

export const boot = new Boot();
