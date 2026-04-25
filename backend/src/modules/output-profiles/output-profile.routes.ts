import { Router } from 'express'
import {
  createOutputProfile,
  deleteOutputProfile,
  getOutputProfile,
  getOutputProfileRuntimePreview,
  getOutputProfileSummary,
  listOutputProfiles,
  updateOutputProfile,
} from './output-profile.service.js'

export const outputProfileRouter: Router = Router()

outputProfileRouter.get('/summary', async (_req, res, next) => {
  try {
    res.json(await getOutputProfileSummary())
  } catch (error) {
    next(error)
  }
})

outputProfileRouter.get('/runtime-preview', async (req, res, next) => {
  try {
    res.json(await getOutputProfileRuntimePreview(req.query.q))
  } catch (error) {
    next(error)
  }
})

outputProfileRouter.get('/', async (req, res, next) => {
  try {
    res.json(
      await listOutputProfiles({
        query: req.query.query,
        active: req.query.active,
        limit: req.query.limit,
      }),
    )
  } catch (error) {
    next(error)
  }
})

outputProfileRouter.post('/', async (req, res, next) => {
  try {
    res.status(201).json(await createOutputProfile(req.body ?? {}))
  } catch (error) {
    next(error)
  }
})

outputProfileRouter.get('/:id', async (req, res, next) => {
  try {
    res.json(await getOutputProfile(req.params.id))
  } catch (error) {
    next(error)
  }
})

outputProfileRouter.put('/:id', async (req, res, next) => {
  try {
    res.json(await updateOutputProfile(req.params.id, req.body ?? {}))
  } catch (error) {
    next(error)
  }
})

outputProfileRouter.delete('/:id', async (req, res, next) => {
  try {
    res.json(await deleteOutputProfile(req.params.id))
  } catch (error) {
    next(error)
  }
})
