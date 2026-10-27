import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

/**
 * 产物指纹的唯一算法入口。取数（比对上游 tree OID 之外的本地文件）、
 * normalize 登记 manifest、测试比对两次建库字节必须走同一个函数：
 * 两处各写一份 createHash，就会出现「自己跟自己不一致」这种无法解释的 diff。
 */
export const sha256Buf = (buf: Buffer): string => createHash('sha256').update(buf).digest('hex')

export const sha256File = (p: string): string => sha256Buf(readFileSync(p))
