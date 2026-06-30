import type { StoryGraphData, StoryGraphNode, PushGraphNode, PushGraphEdge, PushGraphData, SubmissionListItem } from '@/types/storyline'

export interface VisNode {
  id: string
  label: string
  title: string
  color: { background: string; border: string }
  shape: 'box'
  font: { color: string; size: number; face: string }
  borderWidth: number
  borderDashes?: number[] | boolean
  margin: { top: number; bottom: number; left: number; right: number }
}

export interface VisEdge {
  id: string
  from: string
  to: string
  label?: string
  title?: string
  arrows: string
  color: { color: string }
  width: number
  dashes?: number[] | boolean
}

function formatNodeType(type: string): string {
  if (type === 'main') return '主线'
  if (type === 'fork') return '分叉'
  if (type === 'merge') return '合并'
  return type
}

function escapeHtml(text: string): string {
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}

function buildTooltip(node: StoryGraphNode): string {
  const name = escapeHtml(node.name)
  const type = formatNodeType(node.type)
  const desc = node.description ? `<br><br>${escapeHtml(node.description)}` : ''
  const creator = escapeHtml(node.createdBy)
  return `<div style="max-width:280px;line-height:1.5">
    <strong style="font-size:14px">${name}</strong>
    <br><span style="color:#888;font-size:12px">${type}</span>${desc}
    <br><span style="color:#666;font-size:11px">创建者：${creator}</span>
  </div>`
}

function buildPushTooltip(node: PushGraphNode): string {
  const title = escapeHtml(node.title)
  const lineName = escapeHtml(node.lineName)
  const type = formatNodeType(node.lineType)
  const author = escapeHtml(node.authorNickname)
  const seq = node.sequenceIndex + 1
  return `<div style="max-width:280px;line-height:1.5">
    <strong style="font-size:14px">${title}</strong>
    <br><span style="color:#888;font-size:12px">${lineName}（${type}）</span>
    <br><span style="color:#666;font-size:11px">第 ${seq} 个推送 · ${author}</span>
  </div>`
}

function buildHeadTooltip(node: PushGraphNode): string {
  const lineName = escapeHtml(node.lineName)
  const type = formatNodeType(node.lineType)
  const hint = node.isPlaceholder
    ? '<br><span style="color:#999;font-size:11px">该线暂无推送</span>'
    : ''
  return `<div style="max-width:240px;line-height:1.5">
    <strong style="font-size:14px">${lineName}</strong>
    <br><span style="color:#888;font-size:12px">${type}分支</span>${hint}
  </div>`
}

const NODE_THEMES = {
  main: {
    shape: 'box' as const,
    color: { background: '#e8f5f1', border: '#14735a' },
    font: { color: '#14735a', size: 13, face: 'system-ui, sans-serif' },
    borderWidth: 2,
    margin: { top: 8, bottom: 8, left: 14, right: 14 },
  },
  fork: {
    shape: 'box' as const,
    color: { background: '#e8f5f1', border: '#14735a' },
    font: { color: '#14735a', size: 13, face: 'system-ui, sans-serif' },
    borderWidth: 2,
    margin: { top: 8, bottom: 8, left: 14, right: 14 },
  },
  merge: {
    shape: 'box' as const,
    color: { background: '#e8f5f1', border: '#14735a' },
    font: { color: '#14735a', size: 13, face: 'system-ui, sans-serif' },
    borderWidth: 2,
    margin: { top: 8, bottom: 8, left: 14, right: 14 },
  },
}

function nodeTheme(type: string) {
  if (type === 'merge') return NODE_THEMES.merge
  if (type === 'fork') return NODE_THEMES.fork
  return NODE_THEMES.main
}

function truncateLabel(text: string | null | undefined, maxLen = 18): string | undefined {
  if (!text) return undefined
  return text.length > maxLen ? text.slice(0, maxLen) + '...' : text
}

function submissionTitle(push: SubmissionListItem): string {
  return push.title || push.summary
}

export interface BuildVisDataResult {
  nodes: VisNode[]
  edges: VisEdge[]
}

export function buildVisData(data: StoryGraphData): BuildVisDataResult {
  const nodeMap = new Map<string, StoryGraphNode>()
  for (const node of data.nodes) {
    nodeMap.set(node.lineId, node)
  }

  const nodes: VisNode[] = data.nodes.map((node) => ({
    id: node.lineId,
    label: node.name,
    title: buildTooltip(node),
    ...nodeTheme(node.type),
  }))

  const edges: VisEdge[] = data.edges.map((edge) => ({
    id: `${edge.from}--${edge.to}`,
    from: edge.from,
    to: edge.to,
    label: truncateLabel(edge.basedOnPushTitle),
    title: edge.label,
    arrows: 'to',
    color: { color: 'rgba(20,115,90,0.45)' },
    width: 2,
  }))

  return { nodes, edges }
}

export function buildPushGraph(
  storyGraph: StoryGraphData,
  allPushes: SubmissionListItem[],
): PushGraphData {
  const lineMap = new Map<string, StoryGraphNode>()
  for (const node of storyGraph.nodes) {
    lineMap.set(node.lineId, node)
  }

  // Keep approved-pushes API order. The backend returns approved pushes by review time,
  // so graph sequence follows the actual approval/adoption order.
  const pushesByLine = new Map<string, SubmissionListItem[]>()
  for (const push of allPushes) {
    if (!pushesByLine.has(push.targetLineId)) {
      pushesByLine.set(push.targetLineId, [])
    }
    pushesByLine.get(push.targetLineId)!.push(push)
  }

  // Build push-level nodes with line metadata
  const nodes: PushGraphNode[] = []
  const headId = (lineId: string) => `__head__:${lineId}`

  // 1) Create head nodes for every line (always, regardless of pushes)
  for (const line of storyGraph.nodes) {
    const hasPushes = pushesByLine.has(line.lineId)
    nodes.push({
      nodeId: headId(line.lineId),
      pushId: headId(line.lineId),
      lineId: line.lineId,
      title: line.name,
      lineType: line.type as 'main' | 'fork' | 'merge',
      lineName: line.name,
      authorId: '',
      authorNickname: '',
      submittedAt: '',
      sequenceIndex: -1,
      isPlaceholder: !hasPushes,
      isHead: true,
    })
  }

  // 2) Create push nodes for every line that has pushes
  for (const [lineId, pushes] of pushesByLine) {
    const line = lineMap.get(lineId)
    const lineType = line?.type ?? 'fork'
    const lineName = line?.name ?? '未知线'

    pushes.forEach((push, index) => {
      nodes.push({
        nodeId: push.submissionId,
        pushId: push.submissionId,
        lineId,
        title: submissionTitle(push),
        content: push.content,
        lineType: lineType as 'main' | 'fork' | 'merge',
        lineName,
        authorId: push.submitter.userId,
        authorNickname: push.submitter.nickname,
        submittedAt: push.submittedAt,
        sequenceIndex: index,
      })
    })
  }

  // Build edges
  const edges: PushGraphEdge[] = []

  // a) Sequential edges: head → first_push; then push_i → push_{i+1}
  for (const [lineId, pushes] of pushesByLine) {
    // head → first push
    edges.push({
      edgeId: `seq:${headId(lineId)}->${pushes[0].submissionId}`,
      from: headId(lineId),
      to: pushes[0].submissionId,
      edgeType: 'sequential',
      label: '',
      fromLineId: lineId,
      toLineId: lineId,
      basedOnPushTitle: null,
    })

    for (let i = 0; i < pushes.length - 1; i++) {
      edges.push({
        edgeId: `seq:${pushes[i].submissionId}->${pushes[i + 1].submissionId}`,
        from: pushes[i].submissionId,
        to: pushes[i + 1].submissionId,
        edgeType: 'sequential',
        label: '',
        fromLineId: pushes[i].targetLineId,
        toLineId: pushes[i + 1].targetLineId,
        basedOnPushTitle: null,
      })
    }
  }

  // b) Fork / Merge edges from line-parent relationships → child head node
  for (const link of storyGraph.edges) {
    const childLine = lineMap.get(link.childLineId)
    const isMerge = childLine?.type === 'merge'
    const childTargetId = headId(link.childLineId)

    let fromPushId: string | null = null
    let label = ''

    if (link.basedOnPushId) {
      fromPushId = link.basedOnPushId
      label = link.basedOnPushTitle ?? ''
    } else {
      const parentPushes = pushesByLine.get(link.parentLineId)
      if (parentPushes && parentPushes.length > 0) {
        fromPushId = parentPushes[parentPushes.length - 1].submissionId
        label = isMerge ? '合并' : '分叉'
      }
    }

    if (!fromPushId) continue

    edges.push({
      edgeId: `${isMerge ? 'merge' : 'fork'}:${fromPushId}->${childTargetId}`,
      from: fromPushId,
      to: childTargetId,
      edgeType: isMerge ? 'merge' : 'fork',
      label,
      fromLineId: link.parentLineId,
      toLineId: link.childLineId,
      basedOnPushTitle: link.basedOnPushTitle,
    })
  }

  return { nodes, edges }
}

export function pushGraphToVis(pushGraph: PushGraphData): BuildVisDataResult {
  const nodes: VisNode[] = pushGraph.nodes.map((node) => {
    if (node.isHead) {
      return {
        id: node.pushId,
        label: node.lineName,
        title: buildHeadTooltip(node),
        color: { background: '#103b31', border: '#0d3229' },
        shape: 'box' as const,
        font: { color: '#ffffff', size: 14, face: 'system-ui, sans-serif' },
        borderWidth: node.isPlaceholder ? 1 : 2,
        borderDashes: node.isPlaceholder ? [6, 4] : undefined,
        margin: { top: 10, bottom: 10, left: 16, right: 16 },
      }
    }
    return {
      id: node.pushId,
      label: truncateLabel(node.title, 20) ?? node.title.slice(0, 20),
      title: buildPushTooltip(node),
      ...nodeTheme(node.lineType),
    }
  })

  const edges: VisEdge[] = pushGraph.edges.map((edge) => {
    const isFork = edge.edgeType === 'fork'
    const isSequential = edge.edgeType === 'sequential'
    return {
      id: edge.edgeId,
      from: edge.from,
      to: edge.to,
      arrows: 'to',
      color: { color: isSequential ? 'rgba(20,115,90,0.30)' : 'rgba(20,115,90,0.55)' },
      width: isSequential ? 1.5 : 2,
      dashes: isFork ? [6, 4] : undefined,
    }
  })

  return { nodes, edges }
}
