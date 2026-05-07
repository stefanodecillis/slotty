import { stdin, stdout } from 'node:process';

import { db } from '@/lib/db';
import { hashPassword, validatePasswordStrength } from '@/lib/auth/password';
import { lucia } from '@/lib/auth/lucia';

/**
 * Pipe-mode (non-TTY): read all stdin at once and split by newlines. The
 * caller can supply username + password lines without spawning interactive
 * prompts, which is awkward but Bun + readline is unreliable when
 * interleaving multiple readline interfaces.
 *
 * TTY mode: write each prompt one at a time, suppressing echo for password
 * lines via raw mode.
 */

async function readAllStdin(): Promise<string[]> {
  return new Promise((resolve, reject) => {
    let data = '';
    stdin.setEncoding('utf8');
    stdin.on('data', (chunk: string) => {
      data += chunk;
    });
    stdin.on('end', () => {
      resolve(data.split(/\r?\n/));
    });
    stdin.on('error', (err) => reject(err));
  });
}

function readTtyLine(question: string, hidden: boolean): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    stdout.write(question);
    let buf = '';
    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const cleanup = (): void => {
      stdin.setRawMode(wasRaw);
      stdin.pause();
      stdin.off('data', onData);
    };
    const onData = (chunk: string): void => {
      for (const ch of chunk) {
        const code = ch.charCodeAt(0);
        if (code === 0x03) {
          cleanup();
          stdout.write('\n');
          reject(new Error('cancelled'));
          return;
        }
        if (ch === '\n' || ch === '\r') {
          cleanup();
          stdout.write('\n');
          resolve(buf);
          return;
        }
        if (code === 0x7f || code === 0x08) {
          if (buf.length > 0) {
            buf = buf.slice(0, -1);
            if (!hidden) stdout.write('\b \b');
          }
          continue;
        }
        if (code < 0x20) continue;
        buf += ch;
        if (!hidden) stdout.write(ch);
      }
    };
    stdin.on('data', onData);
  });
}

export async function run(argv: string[]): Promise<number> {
  let username: string | undefined = argv[0];
  let password: string;
  let confirm: string;

  if (!stdin.isTTY) {
    const lines = await readAllStdin();
    if (!username) {
      username = lines.shift();
    }
    password = lines.shift() ?? '';
    confirm = lines.shift() ?? '';
  } else {
    if (!username) {
      username = (await readTtyLine('Username: ', false)).trim();
    }
    password = await readTtyLine('New password: ', true);
    confirm = await readTtyLine('Confirm password: ', true);
  }

  if (!username) {
    process.stderr.write('error: username is required\n');
    return 1;
  }

  const user = await db.user.findUnique({ where: { username } });
  if (!user) {
    process.stderr.write(`error: no user found with username "${username}"\n`);
    return 1;
  }

  if (password !== confirm) {
    process.stderr.write('error: passwords do not match\n');
    return 1;
  }

  const strength = validatePasswordStrength(password);
  if (!strength.ok) {
    process.stderr.write(`error: ${strength.reason}\n`);
    return 1;
  }

  const passwordHash = await hashPassword(password);
  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { passwordHash },
    });
  });

  await lucia.invalidateUserSessions(user.id);

  process.stdout.write(`Password reset for ${username}. All sessions invalidated.\n`);
  return 0;
}

export default run;
