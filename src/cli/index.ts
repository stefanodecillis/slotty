/**
 * Slotty CLI entry point. Dispatched via `bun run cli <subcommand> [args]`.
 *
 * Each subcommand lives in `src/cli/commands/<name>.ts` and exports a
 * default `run(argv: string[]): Promise<number>` returning a process exit
 * code. Keep new commands small and self-contained.
 */
export {};

type Command = {
  name: string;
  description: string;
  run: (argv: string[]) => Promise<number>;
};

async function loadCommands(): Promise<Command[]> {
  const resetPassword = await import('./commands/reset-password');
  return [
    {
      name: 'reset-password',
      description: 'Reset a user password and invalidate their sessions.',
      run: resetPassword.run,
    },
    {
      name: 'help',
      description: 'Show this help message.',
      run: async () => {
        printHelp(await loadCommandsLazy());
        return 0;
      },
    },
  ];
}

// Avoid recursive load; only used by `help` to print itself.
async function loadCommandsLazy(): Promise<Command[]> {
  return loadCommands();
}

function printHelp(commands: Command[]): void {
  process.stdout.write('slotty cli\n\nUsage: bun run cli <command> [args]\n\nCommands:\n');
  const width = Math.max(...commands.map((c) => c.name.length));
  for (const c of commands) {
    process.stdout.write(`  ${c.name.padEnd(width)}   ${c.description}\n`);
  }
  process.stdout.write('\n');
}

async function main(): Promise<number> {
  const [, , name, ...rest] = process.argv;
  const commands = await loadCommands();

  if (!name || name === '--help' || name === '-h' || name === 'help') {
    printHelp(commands);
    return 0;
  }

  const command = commands.find((c) => c.name === name);
  if (!command) {
    process.stderr.write(`Unknown command: ${name}\n\n`);
    printHelp(commands);
    return 1;
  }

  return command.run(rest);
}

main()
  .then((code) => {
    process.exit(code);
  })
  .catch((err) => {
    process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
