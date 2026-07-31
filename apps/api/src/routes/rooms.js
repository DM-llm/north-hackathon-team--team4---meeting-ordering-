import express from 'express';

export function createRoomsRouter({ db, listRooms, createRoom, updateRoom }) {
  const router = express.Router();

  router.get('/', (req, res, next) => {
    try {
      res.json({ ok: true, data: listRooms(db, req.query) });
    } catch (error) {
      next(error);
    }
  });

  router.post('/', (req, res, next) => {
    try {
      const result = createRoom(db, req.body, req.actor);
      res.status(201).json({ ok: true, data: result.data, reply: result.reply });
    } catch (error) {
      next(error);
    }
  });

  router.patch('/:roomId', (req, res, next) => {
    try {
      const result = updateRoom(db, req.params.roomId, req.body, req.actor);
      res.json({ ok: true, data: result.data, reply: result.reply });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
