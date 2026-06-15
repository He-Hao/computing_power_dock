const C = require("./constants")
const idFactory = require("./idFactory")
const fmt = require("./format")

const PLACEHOLDER_VALUES = ["待沟通确认", "待沟通", "见需求说明", "待联系", "暂无", "不限", "面议"]

function isPlaceholderValue(value) {
  if (!value) {
    return true
  }
  return PLACEHOLDER_VALUES.indexOf(String(value).trim()) > -1
}

function normalizeRegion(region) {
  if (!region) {
    return ""
  }
  var value = String(region).trim()
  if (C.legacyRegionAliasMap[value] !== undefined) {
    return C.legacyRegionAliasMap[value]
  }
  return value
}

function regionFilterMatched(itemRegion, activeRegion) {
  if (activeRegion === "全部") {
    return true
  }
  if (!itemRegion) {
    return false
  }
  if (itemRegion === activeRegion) {
    return true
  }
  if (activeRegion === "华中" && itemRegion === "中部") {
    return true
  }
  return normalizeRegion(itemRegion) === activeRegion
}

function regionMatched(sourceRegion, targetRegion, sourceCity, targetCity) {
  var source = normalizeRegion(sourceRegion) || sourceRegion
  var target = normalizeRegion(targetRegion) || targetRegion
  if (sourceRegion === "全国" || targetRegion === "全国") {
    return true
  }
  if (source === "华中" && targetRegion === "中部") {
    return true
  }
  if (target === "华中" && sourceRegion === "中部") {
    return true
  }
  if (source && target && source === target) {
    return true
  }
  var sourceText = (sourceCity || "") + (sourceRegion || "")
  var targetText = (targetCity || "") + (targetRegion || "")
  return sourceText.indexOf(targetRegion) > -1 || targetText.indexOf(sourceRegion) > -1
}

function clampScore(value) {
  return Math.min(100, Math.max(0, Math.round(value)))
}

function msSincePublished(publishedAt) {
  if (!publishedAt) {
    return Infinity
  }
  var parsed = fmt.parseDateTime(publishedAt)
  if (isNaN(parsed)) {
    return Infinity
  }
  return Date.now() - parsed
}

function daysSincePublished(publishedAt) {
  return msSincePublished(publishedAt) / 86400000
}

function timeRangeMatched(publishedAt, activeTime) {
  if (!activeTime || activeTime === "all") {
    return true
  }
  if (activeTime === "24h") {
    return msSincePublished(publishedAt) <= 24 * 60 * 60 * 1000
  }
  var age = daysSincePublished(publishedAt)
  if (activeTime === "7d") {
    return age <= 7
  }
  if (activeTime === "30d") {
    return age <= 30
  }
  return true
}

function certFilterMatched(item, activeCert) {
  if (!activeCert || activeCert === "all") {
    return true
  }
  if (activeCert === "license") {
    return item.publisherCertLevel === "license"
  }
  return true
}

function favoriteFilterMatched(item, options) {
  options = options || {}
  var activeFavorite = options.activeFavorite || "all"
  if (activeFavorite !== "favorite") {
    return true
  }
  var favoriteIds = options.favoriteIds || []
  return favoriteIds.indexOf(item.id) > -1
}

/** 单条商机信息完整度（用于列表排序，不依赖浏览者） */
function computeListingQualityScore(listing, options) {
  options = options || {}
  if (!listing) {
    return 0
  }
  var score = 28
  if (listing.title && listing.title.length >= 4) {
    score += 8
  }
  if (listing.type) {
    score += 6
  }
  if (listing.region && !isPlaceholderValue(listing.region)) {
    score += 8
  }
  var summary = (listing.summary || "").trim()
  if (summary.length >= 20) {
    score += 10
  } else if (summary.length >= 8) {
    score += 5
  }
  if (listing.scale && !isPlaceholderValue(listing.scale)) {
    score += 6
  }
  if ((listing.price || listing.budget) && !isPlaceholderValue(listing.price || listing.budget)) {
    score += 5
  }
  if (listing.details && listing.details.length >= 3) {
    score += 6
  }
  if (listing.highlights && listing.highlights.length >= 2) {
    score += 4
  }
  if (listing.attachments && listing.attachments.length > 0) {
    score += 4
  }
  var certLevel = options.certLevel || listing.publisherCertLevel || ""
  if (certLevel === "license") {
    score += 10
  } else if (certLevel === "card") {
    score += 5
  }
  if (listing.verification && listing.verification.indexOf("已初审") > -1) {
    score += 4
  }
  var age = daysSincePublished(listing.publishedAt)
  if (age <= 3) {
    score += 8
  } else if (age <= 7) {
    score += 5
  } else if (age <= 30) {
    score += 2
  }
  return clampScore(score)
}

/** 资源↔需求配对时，两侧应使用同一套品类名（如算力租赁↔算力租赁） */
function resolveListingPairType(listing, isResourceSide) {
  if (!listing || !listing.type) {
    return ""
  }
  return isResourceSide
    ? C.normalizeResourceType(listing.type)
    : C.normalizeDemandType(listing.type)
}

function isSameListingTypePair(source, target, options) {
  options = options || {}
  if (!source || !target) {
    return false
  }
  var isSourceResource = options.isSourceResource
  if (isSourceResource === undefined) {
    isSourceResource = !!(source.id && (source.id.indexOf("RES-") === 0 || source.id.indexOf("URES-") === 0))
  }
  var sourceType = resolveListingPairType(source, isSourceResource)
  var targetType = resolveListingPairType(target, !isSourceResource)
  return !!sourceType && sourceType === targetType
}

function getComplementaryListingTypes(sourceType, isSourceResource) {
  if (!sourceType) {
    return []
  }
  var typeMap = isSourceResource ? C.resourceTypeMap : C.demandTypeMap
  var mapped = typeMap[sourceType]
  if (!mapped || !mapped.length) {
    return []
  }
  return mapped.filter(function(typeName) {
    return typeName && typeName !== sourceType
  })
}

function isComplementaryListingTypePair(source, target, options) {
  options = options || {}
  if (!source || !target || isSameListingTypePair(source, target, options)) {
    return false
  }
  var isSourceResource = options.isSourceResource
  if (isSourceResource === undefined) {
    isSourceResource = !!(source.id && (source.id.indexOf("RES-") === 0 || source.id.indexOf("URES-") === 0))
  }
  var sourceType = resolveListingPairType(source, isSourceResource)
  var targetType = resolveListingPairType(target, !isSourceResource)
  if (!sourceType || !targetType) {
    return false
  }
  return getComplementaryListingTypes(sourceType, isSourceResource).indexOf(targetType) > -1
}

function isCompatibleListingTypePair(source, target, options) {
  return isSameListingTypePair(source, target, options)
    || isComplementaryListingTypePair(source, target, options)
}

function filterPoolBySameListingType(anchor, pool, options) {
  if (!anchor) {
    return pool || []
  }
  return (pool || []).filter(function(item) {
    return isSameListingTypePair(anchor, item, options)
  })
}

function filterPoolByCompatibleListingType(anchor, pool, options) {
  if (!anchor) {
    return pool || []
  }
  return (pool || []).filter(function(item) {
    return isCompatibleListingTypePair(anchor, item, options)
  })
}

/** 两条商机之间的互补匹配分（用于智能推荐） */
function computePairMatchScore(source, target, options) {
  options = options || {}
  if (!source || !target) {
    return { score: 0, reasons: [] }
  }
  var isSourceResource = options.isSourceResource
  if (isSourceResource === undefined) {
    isSourceResource = !!(source.id && (source.id.indexOf("RES-") === 0 || source.id.indexOf("URES-") === 0))
  }
  var sourceType = resolveListingPairType(source, isSourceResource)
  var targetType = resolveListingPairType(target, !isSourceResource)
  var score = 0
  var reasons = []

  if (sourceType && sourceType === targetType) {
    score += 42
    reasons.push("同类型可对接")
  } else if (isComplementaryListingTypePair(source, target, options)) {
    score += 35
    reasons.push("产业链互补")
  }

  if (regionMatched(source.region, target.region, source.city, target.city)) {
    score += 28
    reasons.push("地域相近")
  }

  if (source.tags && target.tags) {
    var sharedTags = source.tags.filter(function(tag) {
      return tag && target.tags.indexOf(tag) > -1 && tag !== sourceType && tag !== targetType
    })
    if (sharedTags.length > 0) {
      score += Math.min(15, sharedTags.length * 5)
      reasons.push("标签相似")
    }
  }

  var sourceScale = source.scale || ""
  var targetScale = target.scale || ""
  if (sourceScale && targetScale && !isPlaceholderValue(sourceScale) && !isPlaceholderValue(targetScale)) {
    score += 5
    reasons.push("规模信息齐全")
  }

  var qualityGap = Math.abs(computeListingQualityScore(source) - computeListingQualityScore(target))
  if (qualityGap <= 15) {
    score += 8
    reasons.push("信息完整度接近")
  }

  if (target.publisherCertLevel === "license") {
    score += 5
    reasons.push("对方已营业执照认证")
  } else if (target.publisherCertLevel === "card") {
    score += 2
  }

  return {
    score: clampScore(score),
    reasons: reasons.slice(0, 3)
  }
}

function getMatchPercent(matchScore) {
  var value = Number(matchScore)
  if (isNaN(value)) {
    return null
  }
  return clampScore(value)
}

function sortItems(items, sortBy) {
  var list = (items || []).slice()
  if (sortBy === "latest") {
    list.sort(function(a, b) {
      return (b.publishedAt || b.createdAt || "").localeCompare(a.publishedAt || a.createdAt || "")
    })
  } else {
    list.sort(function(a, b) {
      var diff = (b.matchScore || 0) - (a.matchScore || 0)
      if (diff !== 0) {
        return diff
      }
      return (b.publishedAt || "").localeCompare(a.publishedAt || "")
    })
  }
  return list
}

function resolveListingDeliveryKind(item) {
  if (!item) {
    return ""
  }
  if (item.deliveryKind === "现货" || item.deliveryKind === "准现货" || item.deliveryKind === "期货") {
    return item.deliveryKind
  }
  var fields = [
    item.title,
    item.cycle,
    item.deliveryTime,
    (item.highlights || []).join(" "),
    (item.tags || []).join(" "),
    item.summary
  ]
  var i
  for (i = 0; i < fields.length; i += 1) {
    var text = String(fields[i] || "")
    if (text.indexOf("准现货") >= 0) {
      return "准现货"
    }
    if (text.indexOf("现货") >= 0) {
      return "现货"
    }
    if (text.indexOf("期货") >= 0) {
      return "期货"
    }
  }
  return ""
}

function deliveryKindFilterMatched(item, activeDeliveryKind) {
  if (!activeDeliveryKind || activeDeliveryKind === "all") {
    return true
  }
  return resolveListingDeliveryKind(item) === activeDeliveryKind
}

function filterItems(items, options) {
  options = options || {}
  var keyword = (options.keyword || "").trim().toLowerCase()
  var activeType = options.activeType || "全部"
  var activeRegion = options.activeRegion || "全部"
  var activeCert = options.activeCert || "all"
  var activeTime = options.activeTime || "all"
  var activeDeliveryKind = options.activeDeliveryKind || "all"

  return (items || []).filter(function(item) {
    if (keyword && idFactory.looksLikeTradeIdKeyword(keyword)) {
      return idFactory.itemMatchesTradeIdKeyword(item, keyword)
    }
    var itemType = C.normalizeResourceType(item.type)
    if (C.resourceTypeOptions.indexOf(itemType) === -1) {
      itemType = C.normalizeDemandType(item.type)
    }
    var typeMatched = activeType === "全部" || itemType === activeType
    var regionOk = regionFilterMatched(item.region, activeRegion)
    var tags = item.tags || []
    var text = (
      item.id + " " + item.submissionId + " " + item.title + " " + item.city + " "
      + item.region + " " + item.summary + " " + tags.join(" ")
    ).toLowerCase()
    var keywordMatched = !keyword
      || idFactory.itemMatchesTradeIdKeyword(item, keyword)
      || text.indexOf(keyword) > -1
    return typeMatched
      && regionOk
      && keywordMatched
      && certFilterMatched(item, activeCert)
      && timeRangeMatched(item.publishedAt || item.createdAt, activeTime)
      && favoriteFilterMatched(item, options)
      && deliveryKindFilterMatched(item, activeDeliveryKind)
  })
}

function filterPoolViewItems(items, options) {
  options = options || {}
  var activeBrowse = options.activeBrowse || "all"
  if (activeBrowse === "all") {
    return items || []
  }
  return (items || []).filter(function(item) {
    if (activeBrowse === "unread") {
      return !item.browseStatus
    }
    if (activeBrowse === "viewed") {
      return item.browseStatusClass === "viewed"
    }
    if (activeBrowse === "applied") {
      return item.browseStatusClass === "applied"
    }
    return true
  })
}

function normalizeProductNameText(value) {
  return String(value || "").trim().toLowerCase()
    .replace(/[\s\-_/·，,。；;：:（）()【】\[\]]+/g, "")
}

function cleanupProductNameCandidate(value) {
  var text = String(value || "").trim()
  if (!text) {
    return ""
  }
  text = text.replace(/^(准现货|现货|期货)\s*/i, "").trim()
  text = text.replace(/\s+\d+\s*台$/i, "").trim()
  text = text.replace(/\d+\s*台$/i, "").trim()
  text = text.replace(/\s+\d+\s*$/i, "").trim()
  return text
}

function extractProductModelTokens(value) {
  var normalized = normalizeProductNameText(value)
  if (!normalized) {
    return []
  }
  var tokens = []
  var seen = {}
  var regex = /[a-z]*\d+[a-z0-9]*|\d+[a-z][a-z0-9]*/gi
  var match
  while ((match = regex.exec(normalized)) !== null) {
    var token = String(match[0] || "").toLowerCase()
    if (token.length < 2 || seen[token]) {
      continue
    }
    seen[token] = true
    tokens.push(token)
  }
  return tokens
}

function computeModelTokenSimilarity(leftName, rightName) {
  var leftTokens = extractProductModelTokens(leftName)
  var rightTokens = extractProductModelTokens(rightName)
  if (!leftTokens.length || !rightTokens.length) {
    return 0
  }
  var best = 0
  leftTokens.forEach(function(leftToken) {
    rightTokens.forEach(function(rightToken) {
      if (leftToken === rightToken) {
        best = Math.max(best, 98)
        return
      }
      var shorter = leftToken.length <= rightToken.length ? leftToken : rightToken
      var longer = leftToken.length > rightToken.length ? leftToken : rightToken
      if (longer.indexOf(shorter) >= 0 && shorter.length >= 2) {
        best = Math.max(best, clampScore(Math.round(82 + (shorter.length / longer.length) * 16)))
      }
    })
  })
  return best
}

function resolveListingProductName(listing) {
  if (!listing) {
    return ""
  }
  var product = cleanupProductNameCandidate(listing.serverProduct || "")
  if (product && !isPlaceholderValue(product)) {
    return product
  }
  if (listing.details && listing.details.length) {
    var i
    for (i = 0; i < listing.details.length; i += 1) {
      var row = listing.details[i]
      if (!row || (row.label !== "产品" && row.label !== "配件名称")) {
        continue
      }
      var detailValue = cleanupProductNameCandidate(row.value || "")
      if (detailValue && !isPlaceholderValue(detailValue)) {
        return detailValue
      }
    }
  }
  if (listing.highlights && listing.highlights.length) {
    var j
    for (j = 0; j < listing.highlights.length; j += 1) {
      var highlight = cleanupProductNameCandidate(listing.highlights[j] || "")
      if (!highlight || isPlaceholderValue(highlight)) {
        continue
      }
      if (extractProductModelTokens(highlight).length) {
        return highlight
      }
    }
  }
  var title = cleanupProductNameCandidate(listing.title || "")
  if (title && !isPlaceholderValue(title)) {
    return title
  }
  return ""
}

function toCharNgrams(text, size) {
  var grams = []
  if (!text) {
    return grams
  }
  size = size || 2
  if (text.length <= size) {
    grams.push(text)
    return grams
  }
  var i
  for (i = 0; i <= text.length - size; i += 1) {
    grams.push(text.slice(i, i + size))
  }
  return grams
}

function jaccardCoefficient(listA, listB) {
  if (!listA.length && !listB.length) {
    return 0
  }
  var mapA = {}
  var mapB = {}
  var keys = {}
  var key
  listA.forEach(function(item) {
    mapA[item] = (mapA[item] || 0) + 1
  })
  listB.forEach(function(item) {
    mapB[item] = (mapB[item] || 0) + 1
  })
  for (key in mapA) {
    keys[key] = true
  }
  for (key in mapB) {
    keys[key] = true
  }
  var intersection = 0
  var union = 0
  for (key in keys) {
    var countA = mapA[key] || 0
    var countB = mapB[key] || 0
    intersection += Math.min(countA, countB)
    union += Math.max(countA, countB)
  }
  return union ? intersection / union : 0
}

function computeProductNameTextSimilarity(leftName, rightName) {
  var left = normalizeProductNameText(leftName)
  var right = normalizeProductNameText(rightName)
  if (!left || !right) {
    return 0
  }
  if (left === right) {
    return 100
  }
  var shorter = left.length <= right.length ? left : right
  var longer = left.length > right.length ? left : right
  if (longer.indexOf(shorter) >= 0) {
    return clampScore(Math.round(78 + (shorter.length / longer.length) * 21))
  }
  var leftTokens = extractProductModelTokens(left)
  var rightTokens = extractProductModelTokens(right)
  if (leftTokens.length && rightTokens.length) {
    var sharedModel = false
    leftTokens.forEach(function(leftToken) {
      if (sharedModel) {
        return
      }
      rightTokens.forEach(function(rightToken) {
        if (leftToken === rightToken || leftToken.indexOf(rightToken) >= 0 || rightToken.indexOf(leftToken) >= 0) {
          sharedModel = true
        }
      })
    })
    if (!sharedModel) {
      return clampScore(Math.max(4, Math.round(jaccardCoefficient(toCharNgrams(left, 2), toCharNgrams(right, 2)) * 18)))
    }
  }
  var bigramScore = jaccardCoefficient(toCharNgrams(left, 2), toCharNgrams(right, 2)) * 100
  var unigramScore = jaccardCoefficient(toCharNgrams(left, 1), toCharNgrams(right, 1)) * 100
  return clampScore(Math.round(Math.max(bigramScore, unigramScore * 0.85)))
}

function computeProductNameSimilarity(leftName, rightName) {
  if (!leftName || !rightName) {
    return 0
  }
  var modelScore = computeModelTokenSimilarity(leftName, rightName)
  if (modelScore >= 82) {
    return modelScore
  }
  var textScore = computeProductNameTextSimilarity(leftName, rightName)
  return clampScore(Math.max(modelScore, textScore))
}

function buildListingSearchHaystack(listing) {
  if (!listing) {
    return ""
  }
  if (listing._matchMeta && listing._matchMeta.searchHaystack) {
    return listing._matchMeta.searchHaystack
  }
  return [
    listing.id,
    listing.submissionId,
    listing.title,
    listing.serverProduct,
    listing.type,
    listing.region,
    listing.summary,
    listing.description
  ].join(" ").toLowerCase()
}

function buildListingMatchMeta(listing) {
  if (!listing) {
    return {
      productName: "",
      modelTokens: [],
      normalizedProductName: "",
      searchHaystack: ""
    }
  }
  if (listing._matchMeta) {
    return listing._matchMeta
  }
  var productName = resolveListingProductName(listing)
  return {
    productName: productName,
    modelTokens: extractProductModelTokens(productName),
    normalizedProductName: normalizeProductNameText(productName),
    searchHaystack: buildListingSearchHaystack(listing)
  }
}

function attachMatchMetaToListings(listings) {
  return (listings || []).map(function(item) {
    if (!item) {
      return item
    }
    return Object.assign({}, item, {
      _matchMeta: buildListingMatchMeta(item)
    })
  })
}

function computeProductNameSimilarityByMeta(anchorMeta, targetMeta) {
  if (!anchorMeta || !targetMeta || !anchorMeta.productName || !targetMeta.productName) {
    return 0
  }
  return computeProductNameSimilarity(anchorMeta.productName, targetMeta.productName)
}

function filterPoolByAnchorProductMeta(anchorMeta, pool, options) {
  options = options || {}
  var maxCandidates = options.maxCandidates || 60
  var poolList = pool || []
  if (!poolList.length) {
    return []
  }
  if (!anchorMeta || !anchorMeta.productName) {
    return poolList.slice(0, maxCandidates)
  }
  var anchorTokens = anchorMeta.modelTokens || []
  var anchorNorm = anchorMeta.normalizedProductName || ""
  var matched = []
  var partial = []
  var rest = []
  poolList.forEach(function(item) {
    if (!item) {
      return
    }
    var meta = item._matchMeta || buildListingMatchMeta(item)
    var tokenHit = anchorTokens.length && (meta.modelTokens || []).some(function(token) {
      return anchorTokens.indexOf(token) >= 0
    })
    if (tokenHit) {
      matched.push(item)
      return
    }
    var norm = meta.normalizedProductName || ""
    if (anchorNorm && norm && (anchorNorm.indexOf(norm) >= 0 || norm.indexOf(anchorNorm) >= 0)) {
      partial.push(item)
      return
    }
    if (anchorTokens.length && meta.searchHaystack) {
      var haystackHit = anchorTokens.some(function(token) {
        return meta.searchHaystack.indexOf(token) >= 0
      })
      if (haystackHit) {
        partial.push(item)
        return
      }
    }
    rest.push(item)
  })
  var result = matched.concat(partial)
  if (result.length < maxCandidates) {
    result = result.concat(rest)
  }
  return result.slice(0, maxCandidates)
}

function sortListingsByProductNameSimilarity(anchor, items) {
  var anchorMeta = buildListingMatchMeta(anchor)
  var list = (items || []).map(function(item) {
    if (!item) {
      return item
    }
    var targetMeta = item._matchMeta || buildListingMatchMeta(item)
    return Object.assign({}, item, {
      productNameSimilarity: computeProductNameSimilarityByMeta(anchorMeta, targetMeta)
    })
  })
  list.sort(function(a, b) {
    var diff = (b.productNameSimilarity || 0) - (a.productNameSimilarity || 0)
    if (diff !== 0) {
      return diff
    }
    diff = (b.relatedScore || 0) - (a.relatedScore || 0)
    if (diff !== 0) {
      return diff
    }
    return (b.publishedAt || b.createdAt || "").localeCompare(a.publishedAt || a.createdAt || "")
  })
  return list
}

function sortResourceDemandMatchesByProductName(resource, demands) {
  return sortListingsByProductNameSimilarity(resource, demands)
}

function sortDemandResourceMatchesByProductName(demand, resources) {
  return sortListingsByProductNameSimilarity(demand, resources)
}

function buildProductAnchoredMatches(anchor, pool, options) {
  options = options || {}
  var limit = options.limit || 3
  var isSourceResource = !!options.isSourceResource
  if (!anchor) {
    return []
  }
  var anchorMeta = buildListingMatchMeta(anchor)
  var candidatePool = filterPoolByAnchorProductMeta(anchorMeta, pool, {
    maxCandidates: Math.max(limit * 4, 40)
  })
  var items = candidatePool.map(function(target) {
    if (!target || target.id === anchor.id) {
      return null
    }
    var targetMeta = target._matchMeta || buildListingMatchMeta(target)
    var pair = computePairMatchScore(anchor, target, { isSourceResource: isSourceResource })
    return Object.assign({}, target, {
      relatedScore: pair.score,
      matchReasons: pair.reasons,
      matchPercent: getMatchPercent(pair.score),
      productNameSimilarity: computeProductNameSimilarityByMeta(anchorMeta, targetMeta)
    })
  }).filter(Boolean)
  items.sort(function(a, b) {
    var diff = (b.productNameSimilarity || 0) - (a.productNameSimilarity || 0)
    if (diff !== 0) {
      return diff
    }
    diff = (b.relatedScore || 0) - (a.relatedScore || 0)
    if (diff !== 0) {
      return diff
    }
    return (b.publishedAt || b.createdAt || "").localeCompare(a.publishedAt || a.createdAt || "")
  })
  return items.slice(0, limit)
}

function buildResourceDemandMatches(resource, pool, options) {
  options = options || {}
  return buildProductAnchoredMatches(resource, pool, {
    limit: options.limit || 3,
    isSourceResource: true
  })
}

function buildDemandResourceMatches(demand, pool, options) {
  options = options || {}
  return buildProductAnchoredMatches(demand, pool, {
    limit: options.limit || 3,
    isSourceResource: false
  })
}

function buildRelatedMatches(source, pool, options) {
  options = options || {}
  var limit = options.limit || 3
  var minScore = options.minScore || 40
  var isSourceResource = options.isSourceResource
  if (isSourceResource) {
    return buildResourceDemandMatches(source, pool, { limit: limit })
  }
  if (isSourceResource === false) {
    return buildDemandResourceMatches(source, pool, { limit: limit })
  }

  return (pool || []).map(function(target) {
    if (target.id === source.id) {
      return null
    }
    var pair = computePairMatchScore(source, target, { isSourceResource: isSourceResource })
    return Object.assign({}, target, {
      relatedScore: pair.score,
      matchReasons: pair.reasons,
      matchPercent: getMatchPercent(pair.score)
    })
  }).filter(function(item) {
    return item && item.relatedScore >= minScore
  }).sort(function(a, b) {
    return b.relatedScore - a.relatedScore
  }).slice(0, limit)
}

function applyQualityScores(listings, certLevelByPhone) {
  certLevelByPhone = certLevelByPhone || {}
  return (listings || []).map(function(item) {
    var certLevel = item.publisherCertLevel || certLevelByPhone[item.ownerPhone || item.phone || ""] || ""
    var matchScore = computeListingQualityScore(item, { certLevel: certLevel })
    return Object.assign({}, item, { matchScore: matchScore })
  })
}

function buildApprovedListingScore(listing) {
  return computeListingQualityScore(listing, {
    certLevel: listing.publisherCertLevel
  })
}

module.exports = {
  regionFilterMatched,
  regionMatched,
  computeListingQualityScore,
  computePairMatchScore,
  getMatchPercent,
  isSameListingTypePair,
  isComplementaryListingTypePair,
  isCompatibleListingTypePair,
  filterPoolBySameListingType,
  filterPoolByCompatibleListingType,
  getComplementaryListingTypes,
  resolveListingPairType,
  sortItems,
  filterItems,
  filterPoolViewItems,
  resolveListingDeliveryKind,
  deliveryKindFilterMatched,
  buildRelatedMatches,
  buildResourceDemandMatches,
  buildDemandResourceMatches,
  resolveListingProductName,
  computeProductNameSimilarity,
  extractProductModelTokens,
  buildListingMatchMeta,
  buildListingSearchHaystack,
  attachMatchMetaToListings,
  filterPoolByAnchorProductMeta,
  sortResourceDemandMatchesByProductName,
  sortDemandResourceMatchesByProductName,
  applyQualityScores,
  buildApprovedListingScore,
  isPlaceholderValue
}
