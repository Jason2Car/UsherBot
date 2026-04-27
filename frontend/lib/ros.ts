import { supabase } from '@/lib/supabase';

export type NavResult = 'succeeded' | 'aborted' | 'rejected' | 'canceled' | 'failed';

const TERMINAL: ReadonlySet<string> = new Set([
  'succeeded',
  'aborted',
  'rejected',
  'canceled',
  'failed',
]);

export async function sendNavGoal(
  reservationId: string,
  onResult: (result: NavResult) => void,
): Promise<() => void> {
  const { error } = await supabase
    .from('requests')
    .update({ nav_status: 'pending' })
    .eq('id', reservationId);
  if (error) throw new Error(error.message);

  let cancelled = false;
  void (async () => {
    while (!cancelled) {
      await new Promise((r) => setTimeout(r, 1000));
      if (cancelled) return;
      const { data, error } = await supabase
        .from('requests')
        .select('nav_status')
        .eq('id', reservationId)
        .single();
      if (error || !data) continue;
      const status = data.nav_status as string;
      if (TERMINAL.has(status)) {
        onResult(status as NavResult);
        return;
      }
    }
  })();

  return () => {
    cancelled = true;
    void supabase
      .from('requests')
      .update({ nav_status: 'idle' })
      .eq('id', reservationId)
      .eq('nav_status', 'pending')
      .then(() => {});
  };
}
