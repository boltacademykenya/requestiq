'use client'

import { useState } from 'react'
import type { ProductDto } from '@/lib/api/dto'
import { apiDelete, apiList, apiSend, withQuery } from '@/lib/api/client'
import {
  DataTable,
  EmptyState,
  Field,
  Notice,
  PaginationNote,
  Panel,
  Spinner,
  buttonPrimary,
  buttonSecondary,
  formatMoney,
  inputClass,
  tdClass,
} from './ui'
import { useResource } from './use-resource'

const EMPTY_FORM = { name: '', price: '', sku: '', category: '', unit: '' }

type FormState = typeof EMPTY_FORM

export default function ProductsTab({ canWrite, currency }: { canWrite: boolean; currency: string }) {
  const [search, setSearch] = useState('')
  const [committedSearch, setCommittedSearch] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [showForm, setShowForm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [mutationError, setMutationError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const { data, error, loading, reload } = useResource(
    () =>
      apiList<ProductDto>(
        withQuery('/api/v1/products', {
          limit: 25,
          search: committedSearch,
          activeOnly: showInactive ? 'false' : 'true',
        }),
      ),
    [committedSearch, showInactive],
  )

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setMutationError(null)
    setNotice(null)
    try {
      await apiSend<ProductDto>('/api/v1/products', 'POST', {
        name: form.name.trim(),
        price: Number(form.price),
        ...(form.sku.trim() ? { sku: form.sku.trim() } : {}),
        ...(form.category.trim() ? { category: form.category.trim() } : {}),
        ...(form.unit.trim() ? { unit: form.unit.trim() } : {}),
      })
      setForm(EMPTY_FORM)
      setShowForm(false)
      setNotice(`${form.name.trim()} was added to your catalogue.`)
      reload()
    } catch (cause) {
      setMutationError(cause instanceof Error ? cause.message : 'We could not save that product.')
    } finally {
      setBusy(false)
    }
  }

  async function deactivate(product: ProductDto) {
    if (!window.confirm(`Remove ${product.name} from the active catalogue?`)) return
    setMutationError(null)
    setNotice(null)
    try {
      await apiDelete(`/api/v1/products/${product.id}`)
      setNotice(`${product.name} was removed from the active catalogue.`)
      reload()
    } catch (cause) {
      setMutationError(cause instanceof Error ? cause.message : 'We could not update that product.')
    }
  }

  const products = data?.items ?? []

  return (
    <div className="space-y-5">
      {mutationError && <Notice>{mutationError}</Notice>}
      {notice && <Notice tone="success">{notice}</Notice>}

      <Panel
        title="Catalogue"
        description="Products drive the server-side pricing applied to new orders."
        actions={
          canWrite ? (
            <button type="button" className={buttonPrimary} onClick={() => setShowForm((open) => !open)}>
              {showForm ? 'Cancel' : 'Add product'}
            </button>
          ) : null
        }
      >
        {showForm && canWrite && (
          <form onSubmit={create} className="well mb-6 grid gap-4 p-4 sm:grid-cols-2">
            <Field label="Product name">
              <input
                required
                minLength={2}
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                className={inputClass}
              />
            </Field>
            <Field label={`Unit price (${currency})`}>
              <input
                required
                type="number"
                min="0"
                step="0.01"
                value={form.price}
                onChange={(event) => setForm({ ...form, price: event.target.value })}
                className={inputClass}
              />
            </Field>
            <Field label="SKU (optional)" hint="Unique per workspace when set.">
              <input
                value={form.sku}
                onChange={(event) => setForm({ ...form, sku: event.target.value })}
                className={inputClass}
              />
            </Field>
            <Field label="Category (optional)">
              <input
                value={form.category}
                onChange={(event) => setForm({ ...form, category: event.target.value })}
                className={inputClass}
              />
            </Field>
            <Field label="Unit (optional)" hint="Defaults to 'unit', e.g. bag, crate, litre.">
              <input
                value={form.unit}
                onChange={(event) => setForm({ ...form, unit: event.target.value })}
                className={inputClass}
              />
            </Field>
            <div className="flex items-end">
              <button type="submit" disabled={busy} className={buttonPrimary}>
                {busy ? 'Saving…' : 'Save product'}
              </button>
            </div>
          </form>
        )}

        <form
          onSubmit={(event) => {
            event.preventDefault()
            setCommittedSearch(search.trim())
          }}
          className="mb-4 flex flex-wrap gap-2"
        >
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search products…"
            aria-label="Search products"
            className={inputClass}
          />
          <button type="submit" className={buttonSecondary}>
            Search
          </button>
          <button
            type="button"
            className={buttonSecondary}
            onClick={() => setShowInactive((value) => !value)}
          >
            {showInactive ? 'Active only' : 'Include inactive'}
          </button>
        </form>

        {loading ? (
          <Spinner label="Loading catalogue…" />
        ) : error ? (
          <Notice onRetry={reload}>{error.message}</Notice>
        ) : products.length === 0 ? (
          <EmptyState
            title={committedSearch ? 'No matching products' : showInactive ? 'No products yet' : 'No active products'}
            description={
              showInactive
                ? 'Add a product to start pricing orders from the catalogue.'
                : 'Everything in the catalogue is inactive. Turn on "Include inactive" to see them.'
            }
          />
        ) : (
          <>
            <DataTable head={['Product', 'SKU', 'Category', 'Unit', 'Price', 'Status', canWrite ? '' : 'Status']}>
              {products.map((product) => (
                <tr key={product.id}>
                  <td className={`${tdClass} font-medium text-slate-900`}>{product.name}</td>
                  <td className={tdClass}>{product.sku ?? '—'}</td>
                  <td className={tdClass}>{product.category ?? '—'}</td>
                  <td className={tdClass}>{product.unit}</td>
                  <td className={`${tdClass} font-semibold`}>{formatMoney(product.price, currency)}</td>
                  <td className={tdClass}>{product.isActive ? 'Active' : 'Inactive'}</td>
                  <td className={tdClass}>
                    {canWrite && product.isActive && (
                      <button
                        type="button"
                        onClick={() => void deactivate(product)}
                        className="text-xs font-semibold text-rose-700 hover:underline"
                      >
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </DataTable>
            <PaginationNote count={products.length} total={data?.pagination?.total} />
          </>
        )}
      </Panel>
    </div>
  )
}
