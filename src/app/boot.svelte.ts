/**
 * Start-up tasks behind the preloader's progress bar: fonts, the first dither image and,
 * once models are installed, the inference worker warm-up. Progress is weighted.
 */

interface Task {
  name: string;
  weight: number;
  done: boolean;
}

class Boot {
  private tasks: Task[] = [];
  private settled: Promise<void>[] = [];
  progress = $state(0);
  errors = $state<string[]>([]);

  track<T>(name: string, work: Promise<T>, weight = 1): Promise<T> {
    const task: Task = { name, weight, done: false };
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
    const done = this.tasks.reduce((s, t) => s + (t.done ? t.weight : 0), 0);
    this.progress = total ? done / total : 0;
  }
}

export const boot = new Boot();
