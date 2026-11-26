import {useState} from 'react';
import {FormField} from './components/form-field.js';
import {ChartCard, ChartPlot} from './components/analytics-chart.js';
import {CardGrid} from './components/card.js';
import type {TrainingPoint} from '../../../packages/contracts/intelligence.js';

export default function LossChart({points}: {points: TrainingPoint[]}) {
  const [chosen, setChosen] = useState('');
  const phases = [...new Set(points.map((point) => point.phase))],
    phase = phases.includes(chosen) ? chosen : phases[0],
    data = points.filter((point) => point.phase === phase);
  const hasValidation = data.some((point) => point.validation_loss !== undefined),
    hasNdcg = data.some((point) => point.validation_ndcg !== undefined);
  return (
    <CardGrid>
      <ChartCard
        title="Training and validation loss"
        description="Observed loss by training epoch; lower values indicate less prediction error."
        tools={
          phases.length > 1 ? (
            <FormField
              category="select"
              label="Model"
              value={phase}
              onChange={(event) => setChosen(event.target.value)}
            >
              {phases.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </FormField>
          ) : undefined
        }
      >
        <ChartPlot
          rows={data}
          x="epoch"
          unit="decimal"
          series={[
            {key: 'loss', label: 'Training loss'},
            ...(hasValidation ? [{key: 'validation_loss', label: 'Validation loss'}] : []),
          ]}
        />
      </ChartCard>
      {hasNdcg && (
        <ChartCard
          title="Validation ranking quality"
          description="Observed validation NDCG by epoch, on a scale from 0 to 1."
        >
          <ChartPlot rows={data} x="epoch" unit="score" series={[{key: 'validation_ndcg', label: 'Validation NDCG'}]} />
        </ChartCard>
      )}
    </CardGrid>
  );
}
