/**
 * Embedding 存储适配层
 * 当前使用 localStorage，未来可轻松迁移到后端数据库
 */

const EMBEDDING_STORAGE_KEY = 'thought_embeddings_v1'
const EMBEDDING_MODEL = 'text-embedding-3-small'

/**
 * 计算内容的简单哈希（用于判断内容是否变化）
 */
function contentHash(content) {
  // 简单的哈希函数，用于快速判断内容是否变化
  let hash = 0
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32bit integer
  }
  return hash.toString(36)
}

/**
 * 获取所有 embedding 数据
 */
export function getAllEmbeddings() {
  try {
    const stored = localStorage.getItem(EMBEDDING_STORAGE_KEY)
    if (!stored) return {}
    return JSON.parse(stored)
  } catch (e) {
    console.error('读取 embedding 数据失败:', e)
    return {}
  }
}

/**
 * 获取指定想法的 embedding
 * @param {number} thoughtId - 想法ID
 * @returns {Object|null} - { vector, model, updatedAt, contentHash } 或 null
 */
export function getEmbedding(thoughtId) {
  const embeddings = getAllEmbeddings()
  return embeddings[thoughtId] || null
}

/**
 * 保存 embedding
 * @param {number} thoughtId - 想法ID
 * @param {number[]} vector - 向量数组
 * @param {string} content - 原始内容（用于计算hash）
 * @param {string} model - 模型名称
 */
export function setEmbedding(thoughtId, vector, content, model = EMBEDDING_MODEL) {
  try {
    const embeddings = getAllEmbeddings()
    embeddings[thoughtId] = {
      vector,
      model,
      updatedAt: new Date().toISOString(),
      contentHash: contentHash(content)
    }
    localStorage.setItem(EMBEDDING_STORAGE_KEY, JSON.stringify(embeddings))
  } catch (e) {
    console.error('保存 embedding 失败:', e)
    throw e
  }
}

/**
 * 删除 embedding
 * @param {number} thoughtId - 想法ID
 */
export function deleteEmbedding(thoughtId) {
  try {
    const embeddings = getAllEmbeddings()
    delete embeddings[thoughtId]
    localStorage.setItem(EMBEDDING_STORAGE_KEY, JSON.stringify(embeddings))
  } catch (e) {
    console.error('删除 embedding 失败:', e)
  }
}

/**
 * 检查内容是否变化（需要重新embedding）
 * @param {number} thoughtId - 想法ID
 * @param {string} content - 当前内容
 * @returns {boolean} - true表示内容变化，需要重新embedding
 */
export function needsReembedding(thoughtId, content) {
  const embedding = getEmbedding(thoughtId)
  if (!embedding) return true // 没有embedding，需要生成
  return embedding.contentHash !== contentHash(content) // hash不同，内容变化
}

/**
 * 批量获取多个想法的 embedding
 * @param {number[]} thoughtIds - 想法ID数组
 * @returns {Object} - { [thoughtId]: embedding } 的映射
 */
export function getEmbeddingsByIds(thoughtIds) {
  const embeddings = getAllEmbeddings()
  const result = {}
  thoughtIds.forEach(id => {
    if (embeddings[id]) {
      result[id] = embeddings[id]
    }
  })
  return result
}

/**
 * 获取所有缺失 embedding 的想法ID
 * @param {Array} thoughts - 想法数组 [{id, content, ...}]
 * @returns {number[]} - 缺失embedding的想法ID数组
 */
export function getMissingEmbeddingIds(thoughts) {
  const embeddings = getAllEmbeddings()
  return thoughts
    .filter(thought => {
      const embedding = embeddings[thought.id]
      if (!embedding) return true
      // 检查内容是否变化
      return embedding.contentHash !== contentHash(thought.content)
    })
    .map(thought => thought.id)
}

/**
 * 计算余弦相似度
 * @param {number[]} vec1 - 向量1
 * @param {number[]} vec2 - 向量2
 * @returns {number} - 相似度（0-1）
 */
export function cosineSimilarity(vec1, vec2) {
  if (vec1.length !== vec2.length) {
    throw new Error('向量维度不匹配')
  }
  
  let dotProduct = 0
  let norm1 = 0
  let norm2 = 0
  
  for (let i = 0; i < vec1.length; i++) {
    dotProduct += vec1[i] * vec2[i]
    norm1 += vec1[i] * vec1[i]
    norm2 += vec2[i] * vec2[i]
  }
  
  norm1 = Math.sqrt(norm1)
  norm2 = Math.sqrt(norm2)
  
  if (norm1 === 0 || norm2 === 0) return 0
  return dotProduct / (norm1 * norm2)
}
