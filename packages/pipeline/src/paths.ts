import { join } from 'node:path'

/**
 * 人工表的唯一路径入口。
 *
 * `data/manual/` 这个名字 turbo 的 inputs（`$TURBO_ROOT$/data/manual/**`）与
 * 回滚集合（`git checkout … data/manual …`）都在引用。路径散写就会分成两半，
 * 症状是「改了人工表却不重建产物」——缓存在看一个目录，表放在另一个目录。
 */

export const manualPath = (
  projectRoot: string,
  name: 'factions' | 'rarity' | 'handbook' | 'positions',
): string => join(projectRoot, 'data', 'manual', `${name}.json`)
