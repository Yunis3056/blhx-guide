import tseslint from 'typescript-eslint'
import root from '../../eslint.config.mjs'

/**
 * §4.6 的静态导出守卫，主判据放这儿（不用 grep：`apps/web/src` 之类不存在的目录
 * 会让 `! grep` 静默通过，给出「已守卫」的假象）。
 *
 * `dynamicParams` 不在禁止名单里——它是 §4.6 必须存在的那一个，
 * 用 `(runtime|dynamic)` 这种正则会把它一起杀掉。
 */
export default tseslint.config(
  ...root,
  {
    files: ['app/**/*.ts', 'app/**/*.tsx', 'components/**/*.tsx', 'lib/**/*.ts', 'next.config.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'VariableDeclarator[id.name=/^(dynamic|runtime|revalidate|revalidatePath|revalidateTag|fetchCache|preferredRegion)$/]',
          message: '静态导出（output: export）不允许这些段配置，见 PLAN §4.6',
        },
        {
          selector: 'CallExpression[callee.name=/^(cookies|headers|connection|draftMode|revalidatePath|revalidateTag)$/]',
          message: '静态导出不能使用请求期 API，见 PLAN §4.6',
        },
        {
          // Route Handler 只在中段出现；页面文件里出现即意味着导出运行时接口
          selector: "ExportNamedDeclaration VariableDeclarator[id.name='handlers']",
          message: '静态导出不带 Route Handler',
        },
      ],
    },
  },
)
