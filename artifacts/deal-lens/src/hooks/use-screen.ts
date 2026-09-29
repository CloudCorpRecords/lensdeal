import { useState } from 'react';
import { useCreateScreen } from '@workspace/api-client-react';
import type { ScreenInput, ScreenReport } from '@workspace/api-client-react';

export function useScreen() {
  const [report, setReport] = useState<ScreenReport | null>(null);
  const mutation = useCreateScreen();

  async function runScreen(input: ScreenInput) {
    const result = await mutation.mutateAsync({ data: input });
    setReport(result);
    return result;
  }

  return {
    report,
    runScreen,
    isPending: mutation.isPending,
    isError: mutation.isError,
    error: mutation.error,
    resetError: mutation.reset,
  };
}