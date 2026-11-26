import {Button} from './components/button.js';
import {FormField} from './components/form-field.js';
export function DataSourceBar({
  value,
  onChange,
  stopped,
  onResume,
}: {
  value: string;
  onChange: (v: string) => void;
  stopped: boolean;
  onResume?: () => void;
}) {
  const explanation =
    value === 'recorded'
      ? 'Recorded, consented activity from this website.'
      : value === 'seeded'
        ? 'Generated sample data for demonstrations. These counts are not visitor activity.'
        : 'Earlier mixed data is preserved here. Its source cannot be reliably separated.';
  return (
    <div className={'data-source-bar source-' + value}>
      <div className="source-status">
        <span className="status-light" />
        <strong>
          {value === 'recorded'
            ? 'Recorded activity'
            : value === 'seeded'
              ? 'Generated samples'
              : 'Earlier data · unclassified'}
        </strong>
        <span className="source-caption">
          {value === 'recorded'
            ? 'Consented browser events'
            : value === 'seeded'
              ? 'Not visitor activity'
              : 'Source not verified'}
        </span>
        <span className="source-help" tabIndex={0} title={explanation} aria-label={explanation}>
          i
        </span>
      </div>
      {stopped && (
        <p className="source-stopped" role="alert">
          Collection is stopped.{' '}
          {onResume && (
            <Button variant="text" onClick={onResume}>
              Resume local collection
            </Button>
          )}
        </p>
      )}
      <FormField
        hideLabel
        label="Data source"
        category="select"
        aria-label="Data source"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="recorded">Recorded activity</option>
        <option value="legacy">Earlier data · unclassified</option>
      </FormField>
    </div>
  );
}
