<script lang="ts">
  import type { CanvasNode } from '$lib/api/types';
  import { formatTokenAmount } from '$lib/utils/amount';

  let { nodes }: { nodes: CanvasNode[] } = $props();
</script>

<div class="sr-only">
  <h2>Ticket node fallback list</h2>
  <table>
    <thead>
      <tr>
        <th>Ticket ID</th>
        <th>Outcome</th>
        <th>Current owner</th>
        <th>Original caller</th>
        <th>Status</th>
        <th>Listed price</th>
        <th>Confidence</th>
      </tr>
    </thead>
    <tbody>
      {#each nodes as node}
        <tr>
          <td>{node.ticket_id}</td>
          <td>{node.outcome_id}</td>
          <td>{node.current_owner ?? node.owner}</td>
          <td>{node.original_caller}</td>
          <td>{node.status}</td>
          <td>{node.listed_price ? formatTokenAmount(node.listed_price) : 'Not listed'}</td>
          <td>{node.confidence}</td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>
