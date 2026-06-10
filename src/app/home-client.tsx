'use client';

import { useReducer, useCallback } from 'react';
import {
  phaseReducer,
  INITIAL_STATE,
  type Action,
} from '@/lib/upload/phase-reducer';
import { validateBatch } from '@/lib/upload/file-validation';
import UploadZone from '@/components/upload-zone';
import StagedFilesList from '@/components/staged-files-list';
import ResultsGrid from '@/components/results-grid';
import { Alert } from '@trussworks/react-uswds';
import { useState } from 'react';

export default function HomeClient() {
  const [state, dispatch] = useReducer(phaseReducer, INITIAL_STATE);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [perFileErrors, setPerFileErrors] = useState<string[]>([]);

  const stageFiles = useCallback((incoming: File[]) => {
    const result = validateBatch([...state.files, ...incoming]);
    if (!result.ok) {
      setValidationError(result.reason ?? 'Could not stage files.');
      setPerFileErrors([]);
      return;
    }
    setValidationError(null);
    setPerFileErrors(result.rejected.map((r) => `${r.file.name}: ${r.reason}`));
    const newFiles = result.files.filter((f) => !state.files.includes(f));
    dispatch({ type: 'FILES_STAGED', files: newFiles });
  }, [state.files]);

  const removeFile = useCallback((file: File) => {
    dispatch({ type: 'FILE_REMOVED', file });
  }, []);

  const onVerify = useCallback(() => {
    dispatch({ type: 'VERIFY_STARTED' });
  }, []);

  const onResult = useCallback((action: Action) => {
    dispatch(action);
  }, []);

  const startOver = useCallback(() => {
    setValidationError(null);
    setPerFileErrors([]);
    dispatch({ type: 'START_OVER' });
  }, []);

  async function loadSample(): Promise<void> {
    try {
      const res = await fetch('/samples/compliant-bourbon.jpg');
      if (!res.ok) {
        setValidationError(
          'Sample label is not available. Add an image at public/samples/compliant-bourbon.jpg.',
        );
        return;
      }
      const blob = await res.blob();
      const file = new File([blob], 'sample-compliant-bourbon.jpg', {
        type: 'image/jpeg',
      });
      stageFiles([file]);
    } catch (e) {
      setValidationError(`Could not load sample: ${(e as Error).message}`);
    }
  }

  return (
    <>
      {(validationError || perFileErrors.length > 0) && (
        <div className="grid-container padding-top-3">
          <div className="grid-row">
            <div className="grid-col-12 desktop:grid-col-8 desktop:grid-offset-2">
              {validationError && (
                <Alert
                  type="error"
                  headingLevel="h3"
                  slim
                  className="margin-bottom-2"
                >
                  {validationError}
                </Alert>
              )}
              {perFileErrors.length > 0 && (
                <Alert
                  type="warning"
                  headingLevel="h3"
                  slim
                  className="margin-bottom-2"
                >
                  Some files were skipped:
                  <ul className="margin-top-1 margin-bottom-0">
                    {perFileErrors.map((m) => (
                      <li key={m}>{m}</li>
                    ))}
                  </ul>
                </Alert>
              )}
            </div>
          </div>
        </div>
      )}

      {state.phase === 'empty' && (
        <UploadZone onFilesSelected={stageFiles} onSampleSelected={loadSample} />
      )}

      {state.phase === 'staged' && (
        <StagedFilesList
          files={state.files}
          onRemove={removeFile}
          onVerify={onVerify}
          onAddMore={stageFiles}
        />
      )}

      {(state.phase === 'processing' || state.phase === 'done') && (
        <ResultsGrid
          files={state.files}
          results={state.results}
          totalExpected={state.totalExpected}
          isStreaming={state.phase === 'processing'}
          onResult={onResult}
          onStartOver={startOver}
        />
      )}
    </>
  );
}
