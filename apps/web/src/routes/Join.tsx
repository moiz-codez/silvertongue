import { useState, type FormEvent } from 'react';
import { NICKNAME_MAX, NICKNAME_MIN } from '@silvertongue/shared/constants';
import { DOOR_SPRITE } from '../sprites.ts';

export function Join({
  notice,
  onJoin,
}: {
  notice: string | null;
  onJoin: (nickname: string) => Promise<string | null>;
}) {
  const [nickname, setNickname] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSending(true);
    setError(await onJoin(nickname));
    setSending(false);
  }

  return (
    <main className="join">
      <p className="eyebrow">An AI security game</p>
      <h1 className="join-title">Silvertongue</h1>
      <p className="join-intro">
        Six guardians. Six secret runes.
        <br />
        You have no sword. Only words.
      </p>
      <img className="sprite join-door" src={DOOR_SPRITE} alt="" />
      {notice && (
        <p className="join-notice" role="status">
          {notice}
        </p>
      )}

      <form onSubmit={submit} className="join-form">
        <label htmlFor="nickname" className="label">
          Choose your name
        </label>
        <input
          id="nickname"
          className="field"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          maxLength={NICKNAME_MAX}
          placeholder="e.g. NightOwl"
          autoComplete="off"
          autoCapitalize="words"
        />
        <p className={error ? 'hint hint-error' : 'hint'} role={error ? 'alert' : undefined}>
          {error ??
            `${NICKNAME_MIN} to ${NICKNAME_MAX} characters. It will appear on the big screen, so keep it classroom-friendly.`}
        </p>
        <button
          className="button-primary"
          disabled={sending || nickname.trim().length < NICKNAME_MIN}
        >
          Enter the dungeon
        </button>
      </form>

      <p className="join-footer">
        No account needed. Your progress is saved on this phone, so you can close the tab and come
        back.
      </p>
    </main>
  );
}
