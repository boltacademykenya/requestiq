'use client'

import { useState } from 'react'
import type { CustomerDto, OrderDto, ProductDto } from '@/lib/api/dto'
import { apiList, apiSend, withQuery } from '@/lib/api/client'
import {
  DataTable,
  EmptyState,
  Field,
  Notice,
  PaginationNote,
  Panel,
  Spinner,
  buttonPrimary,
  formatDate,
  formatMoney,
  inputClass,
  selectClass,
  tdClass,
} from './ui'
import { useResource } from './use-resource'

const ORDER_STATUSES = ['', 'COMPLETED', 'PENDING', 'CANCELLED'] as const

type Draft = {
  customerId: string
  productId: string
  productName: string
  quantity: string
  unitPrice: string
}

const EMPTY_DRAFT: Draft = { customerId: '', productId: '', productName: '', quantity: '1', unitPrice: '' }

export default function OrdersTab({ canWrite, currency }: { canWrite: boolean; currency: string }) {
  const [statusFilter, setStatusFilter] = useState('')
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [showForm, setShowForm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [mutationError, setMutationError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const orders = useResource(
    () => apiList<OrderDto>(withQuery('/api/v1/orders', { limit: 25, status: statusFilter })),
    [statusFilter],
  )

  // The create form needs the pickable customers and catalogue products.
  const customers = useResource(() => apiList<CustomerDto>('/api/v1/customers?limit=100'), [])
  const products = useResource(() => apiList<ProductDto>('/api/v1/products?limit=100'), [])

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setMutationError(null)
    setNotice(null)
    try {
      // The server prices a catalogue match itself; a free-text line must carry a
      // unit price or the request is rejected outright.
      const line =
        draft.productId !== ''
          ? {
              productId: draft.productId,
              productName:
                products.data?.items.find((product) => product.id === draft.productId)?.name ?? '',
              quantity: Number(draft.quantity),
            }
          : {
              productName: draft.productName.trim(),
              quantity: Number(draft.quantity),
              unitPrice: Number(draft.unitPrice),
            }

      await apiSend<OrderDto>('/api/v1/orders', 'POST', { customerId: draft.customerId, items: [line] })
      setDraft(EMPTY_DRAFT)
      setShowForm(false)
      setNotice('Order recorded. Totals were priced from the catalogue server-side.')
      orders.reload()
    } catch (cause) {
      setMutationError(cause instanceof Error ? cause.message : 'We could not record that order.')
    } finally {
      setBusy(false)
    }
  }

  const rows = orders.data?.items ?? []
  const pickableCustomers = customers.data?.items ?? []
  const pickableProducts = products.data?.items ?? []

  return (
    <div className="space-y-5">
      {mutationError && <Notice>{mutationError}</Notice>}
      {notice && <Notice tone="success">{notice}</Notice>}

      <Panel
        title="Orders"
        description="Order history is what reorder predictions are computed from."
        actions={
          canWrite && pickableCustomers.length > 0 ? (
            <button type="button" className={buttonPrimary} onClick={() => setShowForm((open) => !open)}>
              {showForm ? 'Cancel' : 'Record order'}
            </button>
          ) : null
        }
      >
        {showForm && canWrite && (
          <form onSubmit={create} className="well mb-6 grid gap-4 p-4 sm:grid-cols-2">
            <Field label="Customer">
              <select
                required
                value={draft.customerId}
                onChange={(event) => setDraft({ ...draft, customerId: event.target.value })}
                className={selectClass}
              >
                <option value="">Select a customer</option>
                {pickableCustomers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.name}
                  </option>
                ))}
              </select>
            </Field>

            {pickableProducts.length > 0 ? (
              <Field label="Product" hint="The catalogue price is applied server-side.">
                <select
                  required
                  value={draft.productId}
                  onChange={(event) => setDraft({ ...draft, productId: event.target.value })}
                  className={selectClass}
                >
                  <option value="">Select a product</option>
                  {pickableProducts.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name} · {formatMoney(product.price, currency)}
                    </option>
                  ))}
                </select>
              </Field>
            ) : (
              <Field
                label="Product name"
                hint="Not in the catalogue, so a unit price is required below."
              >
                <input
                  required
                  value={draft.productName}
                  onChange={(event) => setDraft({ ...draft, productName: event.target.value })}
                  className={inputClass}
                />
              </Field>
            )}

            {pickableProducts.length === 0 && (
              <Field
                label={`Unit price (${currency})`}
                hint="Required for lines outside the catalogue."
              >
                <input
                  required
                  type="number"
                  min="0"
                  step="0.01"
                  value={draft.unitPrice}
                  onChange={(event) => setDraft({ ...draft, unitPrice: event.target.value })}
                  className={inputClass}
                />
              </Field>
            )}

            <Field label="Quantity">
              <input
                required
                type="number"
                min="1"
                max="100000"
                value={draft.quantity}
                onChange={(event) => setDraft({ ...draft, quantity: event.target.value })}
                className={inputClass}
              />
            </Field>

            <div className="flex items-end">
              <button type="submit" disabled={busy} className={buttonPrimary}>
                {busy ? 'Recording…' : 'Record order'}
              </button>
            </div>
          </form>
        )}

        {canWrite && pickableCustomers.length === 0 && !customers.loading && (
          <div className="mb-4">
            <Notice tone="info">Add a customer first — orders must reference one.</Notice>
          </div>
        )}

        <div className="mb-4 flex flex-wrap gap-2">
          {ORDER_STATUSES.map((status) => (
            <button
              key={status || 'ALL'}
              type="button"
              onClick={() => setStatusFilter(status)}
              className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                statusFilter === status
                  ? 'bg-emerald-700 text-white shadow-sm shadow-emerald-900/20'
                  : 'bg-wash text-slate-600 hover:bg-wash-strong hover:text-slate-900'
              }`}
            >
              {status || 'All'}
            </button>
          ))}
        </div>

        {orders.loading ? (
          <Spinner label="Loading orders…" />
        ) : orders.error ? (
          <Notice onRetry={orders.reload}>{orders.error.message}</Notice>
        ) : rows.length === 0 ? (
          <EmptyState
            title="No orders yet"
            description="Record an order or import history to start computing reorder intervals."
          />
        ) : (
          <>
            <DataTable head={['Reference', 'Status', 'Source', 'Items', 'Total', 'Ordered']}>
              {rows.map((order) => (
                <tr key={order.id}>
                  <td className={`${tdClass} font-medium text-slate-900`}>{order.reference}</td>
                  <td className={tdClass}>{order.status}</td>
                  <td className={tdClass}>{order.source}</td>
                  <td className={tdClass}>{order.items.length}</td>
                  <td className={`${tdClass} font-semibold`}>{formatMoney(order.total, order.currency)}</td>
                  <td className={tdClass}>{formatDate(order.orderedAt)}</td>
                </tr>
              ))}
            </DataTable>
            <PaginationNote count={rows.length} total={orders.data?.pagination?.total} />
          </>
        )}
      </Panel>
    </div>
  )
}
