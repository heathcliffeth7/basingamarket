<script lang="ts">
  import type { CanvasRegion } from '$lib/api/types';
  import OutcomeRegion from './OutcomeRegion.svelte';

  let {
    regions,
    activeOutcomeId = null,
    selectedTicketId = null,
    mode = 'detail',
    dominantOutcomeId = null
  }: {
    regions: CanvasRegion[];
    activeOutcomeId?: string | null;
    selectedTicketId?: string | null;
    mode?: 'simple' | 'detail';
    dominantOutcomeId?: string | null;
  } = $props();
</script>

<g aria-hidden="true">
  {#each regions as region (region.outcome_id)}
    <OutcomeRegion
      {region}
      {mode}
      dominant={dominantOutcomeId === region.outcome_id}
      active={activeOutcomeId === null || activeOutcomeId === region.outcome_id || selectedTicketId === null}
    />
  {/each}
</g>
